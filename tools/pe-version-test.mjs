// `peFileVersion` — the reader that says which build an MPQ-era Warcraft III is
// (src/vfs/peVersion.ts).
//
// **The fixture is SYNTHETIC, and it has to be.** The file this parses for real is the player's
// own `War3.exe`, and OpenWar3 ships zero Blizzard bytes (CLAUDE.md "Legal boundary") — so a test
// that committed one would be the one place that rule broke. Everything below builds a minimal
// but VALID PE image in memory: a DOS header, a COFF header, one `.rsrc` section, and a
// three-level resource directory reaching a `VS_VERSION_INFO`.
//
// The reader was verified against the real thing by hand and that is recorded where it belongs,
// in src/vfs/peVersion.ts's header: the retail 1.27 install's `War3.exe` reports `1.27.0.52240`,
// and the launcher `Warcraft III.exe` beside it reports `1.0.0.1` — which is the whole reason the
// name is matched exactly rather than "any .exe".
//
// Run: pnpm pe:test   (compiles src/vfs/peVersion.ts with tools/tsconfig.casc.json first)

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(REPO, ".casc-build");

// `tools/tsconfig.casc.json` emits CommonJS into `.casc-build`, and this repo's own package.json
// says `"type": "module"` — so the directory needs its own marker or Node reads the emit as ESM
// and dies on its first `exports.`. `tools/install.cjs` writes the same file on demand; writing it
// here too is what lets this test run on its own, before any tool that mounts an install has.
mkdirSync(BUILD, { recursive: true });
writeFileSync(join(BUILD, "package.json"), '{"type":"commonjs"}');

const require = createRequire(import.meta.url);
const { peFileVersion } = require(join(BUILD, "src", "vfs", "peVersion.js"));

let failures = 0;
function ok(name, pass, detail = "") {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${pass || !detail ? "" : `  — ${detail}`}`);
  if (!pass) failures++;
}

const RESOURCE_OFFSET = 0x200; // the .rsrc section's file offset
const RESOURCE_RVA = 0x1000;
const VERSION_OFFSET = 0x300; // where the VS_VERSION_INFO blob sits
const VERSION_RVA = 0x1100;
const DIR = 96; // data directories begin here in a PE32 optional header

/**
 * A minimal PE32 image whose resource table holds one `RT_VERSION` resource — optionally at a
 * different resource TYPE, so the "no version resource here" case can be built from the same
 * code — carrying `major.minor.build.revision`.
 */
function buildPe({ major, minor, build, revision, productZeroed = false, resourceType = 16 }) {
  const b = new Uint8Array(0x400);
  const u16 = (at, v) => { b[at] = v & 0xff; b[at + 1] = (v >>> 8) & 0xff; };
  const u32 = (at, v) => { b[at] = v & 0xff; b[at + 1] = (v >>> 8) & 0xff; b[at + 2] = (v >>> 16) & 0xff; b[at + 3] = (v >>> 24) & 0xff; };

  // DOS header → PE header at 0x80.
  b[0] = 0x4d; b[1] = 0x5a;
  u32(0x3c, 0x80);
  u32(0x80, 0x00004550); // "PE\0\0"
  u16(0x84, 0x014c); // i386
  u16(0x86, 1); // one section
  u16(0x94, 224); // SizeOfOptionalHeader

  const opt = 0x98;
  u16(opt, 0x10b); // PE32, so the data directories start at +96
  u32(opt + DIR + 2 * 8, RESOURCE_RVA); // IMAGE_DIRECTORY_ENTRY_RESOURCE

  // One section mapping RVA 0x1000 → file 0x200.
  const section = opt + 224;
  for (const [i, c] of [...".rsrc"].entries()) b[section + i] = c.charCodeAt(0);
  u32(section + 8, 0x200); // VirtualSize
  u32(section + 12, RESOURCE_RVA); // VirtualAddress
  u32(section + 16, 0x200); // SizeOfRawData
  u32(section + 20, RESOURCE_OFFSET); // PointerToRawData

  // Three levels: type 16 → name 1 → language 0x409 → the data entry.
  u16(RESOURCE_OFFSET + 14, 1); // NumberOfIdEntries
  u32(RESOURCE_OFFSET + 16, resourceType);
  u32(RESOURCE_OFFSET + 20, 0x80000018); // …a subdirectory, at +0x18
  const l2 = RESOURCE_OFFSET + 0x18;
  u16(l2 + 14, 1);
  u32(l2 + 16, 1);
  u32(l2 + 20, 0x80000030);
  const l3 = RESOURCE_OFFSET + 0x30;
  u16(l3 + 14, 1);
  u32(l3 + 16, 0x409);
  u32(l3 + 20, 0x50); // high bit CLEAR: a leaf, not a directory
  const dataEntry = RESOURCE_OFFSET + 0x50;
  u32(dataEntry, VERSION_RVA);
  u32(dataEntry + 4, 0x100); // Size

  // VS_VERSIONINFO: wLength, wValueLength, wType, "VS_VERSION_INFO", pad, VS_FIXEDFILEINFO.
  u16(VERSION_OFFSET, 0x100);
  u16(VERSION_OFFSET + 2, 52); // wValueLength — the fixed info's size
  const key = "VS_VERSION_INFO";
  for (let i = 0; i < key.length; i++) u16(VERSION_OFFSET + 6 + i * 2, key.charCodeAt(i));
  const fixed = VERSION_OFFSET + 40; // 6 + (16 chars + NUL) * 2 = 38, padded to 40
  u32(fixed, 0xfeef04bd);
  u32(fixed + 4, 0x00010000); // dwStrucVersion
  u32(fixed + 8, (major << 16) | minor);
  u32(fixed + 12, (build << 16) | revision);
  u32(fixed + 16, productZeroed ? 0 : (major << 16) | minor);
  u32(fixed + 20, productZeroed ? 0 : (build << 16) | revision);
  return b;
}

console.log("peFileVersion — the version resource inside a game executable");
{
  const exe = buildPe({ major: 1, minor: 27, build: 0, revision: 52240 });
  ok("reads a version resource", peFileVersion(exe) === "1.27.0.52240", String(peFileVersion(exe)));

  const other = buildPe({ major: 1, minor: 29, build: 2, revision: 9231 });
  ok("…and another", peFileVersion(other) === "1.29.2.9231", String(peFileVersion(other)));

  // The four fields are 16 bits each, so a build number past 65535 would not survive the format
  // — it does not have to, and this pins that we read the fields and not a decimal string.
  const big = buildPe({ major: 1, minor: 30, build: 4, revision: 65535 });
  ok("reads all four fields", peFileVersion(big) === "1.30.4.65535", String(peFileVersion(big)));

  // ProductVersion is preferred, FileVersion is the fallback — a stray toolchain sometimes
  // leaves the product fields at zero while filling these.
  const fallback = buildPe({ major: 1, minor: 27, build: 0, revision: 52240, productZeroed: true });
  ok("falls back to FileVersion when ProductVersion is zero", peFileVersion(fallback) === "1.27.0.52240", String(peFileVersion(fallback)));

  const noVersion = buildPe({ major: 1, minor: 27, build: 0, revision: 52240, resourceType: 3 });
  ok("a folder with no version resource reads as unknown", peFileVersion(noVersion) === null, String(peFileVersion(noVersion)));

  // Everything that is not a PE with a version resource answers null rather than throwing or
  // guessing: the load gate turns null into "this folder does not say which Warcraft III it is",
  // which is a sentence a player can act on, and a wrong number would not be.
  ok("an empty file", peFileVersion(new Uint8Array(0)) === null);
  ok("not an executable at all", peFileVersion(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])) === null);
  ok("a DOS header with nothing behind it", peFileVersion(Uint8Array.from([0x4d, 0x5a, ...new Array(200).fill(0)])) === null);
  ok("an MZ that points past the end", peFileVersion(Uint8Array.from([0x4d, 0x5a, ...new Array(0x3c).fill(0), 0xff, 0xff, 0xff, 0x7f])) === null);

  // A truncated image, and every single-byte corruption of the header, must stay a null rather
  // than a throw — this runs on the load gate, in front of a folder nobody has vetted.
  let threw = 0;
  const good = buildPe({ major: 1, minor: 27, build: 0, revision: 52240 });
  for (let n = 0; n < good.length; n += 7) {
    try { peFileVersion(good.subarray(0, n)); } catch { threw++; }
  }
  ok("truncations never throw", threw === 0, `${threw} threw`);

  threw = 0;
  for (let i = 0; i < 0x180; i++) {
    const flipped = good.slice();
    flipped[i] ^= 0xff;
    try { peFileVersion(flipped); } catch { threw++; }
  }
  ok("corrupted headers never throw", threw === 0, `${threw} threw`);
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall pe-version checks passed");
