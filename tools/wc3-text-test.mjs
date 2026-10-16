// `wc3TextDecoder` — how a Warcraft III text file is decoded (src/vfs/text.ts).
//
// The rule is small and the bug it fixes was small too, which is exactly why it is pinned here: a
// first cut stripped the BOM and then decoded the rest with the CALLER's fallback codepage, so a
// Simplified-Chinese install's `GlobalStrings.fdf` came out as `å•äººæ¨¡å¼` and the main menu was
// unreadable while every test stayed green. A BOM has to switch the CODEPAGE, not just skip three
// bytes.
//
// Run: pnpm text:test   (compiles src/vfs/text.ts with tools/tsconfig.casc.json first)

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(REPO, ".casc-build");

// `tsc -p tools/tsconfig.casc.json` emits CommonJS while the repo's own package.json says
// `"type": "module"`, so the build directory needs its own marker (tools/install.cjs writes the
// same one on demand — see tools/pe-version-test.mjs).
mkdirSync(BUILD, { recursive: true });
writeFileSync(join(BUILD, "package.json"), '{"type":"commonjs"}');

const require = createRequire(import.meta.url);
const { wc3TextDecoder } = require(join(BUILD, "src", "vfs", "text.js"));

let failures = 0;
const ok = (name, pass, detail = "") => {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${pass || !detail ? "" : `  — ${detail}`}`);
  if (!pass) failures++;
};

/** Bytes: the UTF-8 BOM, then whatever follows. */
const bom = [0xef, 0xbb, 0xbf];
const utf8 = (s) => [...new TextEncoder().encode(s)];
const bytes = (...parts) => new Uint8Array(parts.flat());

console.log("wc3TextDecoder — a file's own declaration decides its codepage");
{
  // The case that started this: a BOM'd UTF-8 file read through a `latin1` caller, which is what
  // the FDF library asks for. The BOM must win over the caller's fallback.
  const chinese = bytes(bom, utf8('KEY_SINGLE_PLAYER  "单人模式"'));
  ok("a BOM'd file is read as UTF-8, whatever the caller asked for",
     wc3TextDecoder("latin1").decode(chinese).includes("单人模式"),
     JSON.stringify(wc3TextDecoder("latin1").decode(chinese)));
  ok("…and the same through the default caller",
     wc3TextDecoder().decode(chinese).includes("单人模式"));

  // The BOM is REMOVED, not decoded. As `latin1` it is three visible characters; as `utf-8` it is
  // a U+FEFF that lands inside the file's first key and mis-keys it.
  const decoded = wc3TextDecoder().decode(chinese);
  ok("the BOM itself is not in the text", !decoded.includes("﻿") && !decoded.startsWith("ï»¿"), JSON.stringify(decoded.slice(0, 8)));
  ok("…so the first key of the file is intact", decoded.startsWith("KEY_SINGLE_PLAYER"), JSON.stringify(decoded.slice(0, 20)));

  // No BOM: nothing changes for the installs that always worked. windows-1252 maps 0x80–0x9F to
  // real punctuation; `latin1` returns those bytes unchanged, which is what a caller parsing
  // numbers out of an FDF wants.
  // …and, because a BOM is NOT how every localized file announces itself, a BOM-less file that
  // is valid UTF-8 throughout. Measured on a Simplified-Chinese 1.27 install: of the 85 files
  // carrying CJK, 56 have the BOM and 29 do not, and the split runs straight through the object
  // data — `HumanUnitStrings.txt` has one and `NightElfUnitStrings.txt` does not, which is why
  // the Human menu read correctly while every Night Elf unit was `å°ç²¾çµ`.
  const chineseNoBom = bytes(utf8('Name=小精灵'));
  ok("a BOM-less file that IS valid UTF-8 is read as UTF-8",
     wc3TextDecoder().decode(chineseNoBom) === "Name=小精灵",
     JSON.stringify(wc3TextDecoder().decode(chineseNoBom)));
  ok("…through the `latin1` callers too",
     wc3TextDecoder("latin1").decode(chineseNoBom) === "Name=小精灵");
  ok("…and through a caller that already said UTF-8",
     wc3TextDecoder("utf-8").decode(chineseNoBom) === "Name=小精灵");

  // THE NO-REGRESSION PROPERTY, which is the whole reason the sniff is safe. A windows-1252 file
  // has high bytes that are malformed as UTF-8 — a German `ü` is the single byte 0xFC, and UTF-8
  // has no lead byte that high — so every install that read correctly still does. The fixture is
  // the FILE's own bytes ("Grüße" in windows-1252: 47 72 FC DF 65), not UTF-8 re-encoded.
  const german = bytes([0x47, 0x72, 0xfc, 0xdf, 0x65]);
  ok("a BOM-less windows-1252 file is still windows-1252",
     wc3TextDecoder().decode(german) === "Grüße",
     JSON.stringify(wc3TextDecoder().decode(german)));
  ok("…an umlaut next to a quote is not mistaken for a sequence",
     wc3TextDecoder().decode(bytes([0xfc, 0x93])) === "ü“",
     JSON.stringify(wc3TextDecoder().decode(bytes([0xfc, 0x93]))));
  // GBK is what a different Chinese install would use, and it is NOT valid UTF-8 — so it keeps
  // the codepage and stays garbled, exactly as documented, rather than turning into a third kind
  // of garbage. "中文" in GBK is D6 D0 CE C4; D6 D0 is a malformed sequence.
  ok("a GBK byte pair falls through to the codepage",
     wc3TextDecoder().decode(bytes([0xd6, 0xd0, 0xce, 0xc4])) === "ÖÐÎÄ",
     JSON.stringify(wc3TextDecoder().decode(bytes([0xd6, 0xd0, 0xce, 0xc4]))));

  const accent = bytes(utf8("Caf"), [0xe9]); // "Café", latin-1 encoded
  ok("a file with no BOM is read with the caller's codepage", wc3TextDecoder().decode(accent) === "Café", JSON.stringify(wc3TextDecoder().decode(accent)));
  // `latin1` is NOT iso-8859-1 here: the Encoding standard makes it an ALIAS for windows-1252, so
  // 0x80–0x9F become punctuation rather than control bytes. Pinned because the call sites and the
  // doc comment both read as though the two spellings were different decoders, and they are not.
  ok("…and `latin1` is an alias for windows-1252, not ISO-8859-1", wc3TextDecoder("latin1").decode(bytes([0x80, 0x93])) === "€“", JSON.stringify(wc3TextDecoder("latin1").decode(bytes([0x80, 0x93]))));
  ok("…which is what windows-1252 gives too", wc3TextDecoder().decode(bytes([0x80, 0x93])) === "€“", JSON.stringify(wc3TextDecoder().decode(bytes([0x80, 0x93]))));

  // A caller that already said UTF-8 (a `war3map.wts`, the install's `common.j`) still needs the
  // BOM dropped, or it becomes the first character of the first line.
  ok("a UTF-8 caller drops the BOM too", wc3TextDecoder("utf-8").decode(chinese) === 'KEY_SINGLE_PLAYER  "单人模式"', JSON.stringify(wc3TextDecoder("utf-8").decode(chinese)));

  // What `File.arrayBuffer()` and a `Uint8Array.subarray` actually hand over.
  ok("an ArrayBuffer is accepted", wc3TextDecoder().decode(chinese.buffer) === 'KEY_SINGLE_PLAYER  "单人模式"');
  const offset = bytes([0x00, 0x00], bom, utf8("hi"));
  ok("…and a view with a byteOffset", wc3TextDecoder().decode(offset.subarray(2)) === "hi", JSON.stringify(wc3TextDecoder().decode(offset.subarray(2))));

  // Degenerate inputs, all of which reach this on a real install.
  ok("empty", wc3TextDecoder().decode(new Uint8Array(0)) === "");
  ok("two bytes that are not a BOM", wc3TextDecoder().decode(bytes([0xef, 0xbb])) === "ï»");
  ok("a BOM alone is empty text", wc3TextDecoder().decode(bytes(bom)) === "");
  ok("a UTF-8 payload that is not valid UTF-8 does not throw", typeof wc3TextDecoder().decode(bytes(bom, [0xff, 0xfe])) === "string");
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall wc3-text checks passed");
