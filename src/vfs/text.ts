// How a Warcraft III text file is decoded, in one place.
//
// Every data file the game reads outside the binary formats — `*.slk`, `*.txt`, `*.fdf`,
// `war3map.wts` — is 8-bit text in the machine's own ANSI codepage, because that is what the
// World Editor wrote in 2002 and what the engine still reads. For the English, German and French
// installs that codepage is windows-1252, which is what this engine assumed for its whole life.
//
// **A localized install is the case that assumption misses, and it does not announce itself the
// same way twice.** Measured against a Simplified-Chinese 1.27 install, of the 85 files carrying
// CJK text, **56 begin with the UTF-8 byte-order mark and 29 do not** — and the split runs
// straight through the object data, which is what makes it look arbitrary from the outside:
//
//     Units\HumanUnitStrings.txt      BOM      hfoo → 步兵          ✓
//     Units\NeutralUnitStrings.txt    BOM      nmer → 雇佣兵营地     ✓
//     Units\NightElfUnitStrings.txt   no BOM   ewsp → å°ç²¾çµ      ✗
//     Units\NeutralUpgradeStrings.txt no BOM   …      æœˆä¹‹åŠ›é‡     ✗
//
// So one rule is not enough and neither is the other:
//
//   • a BOM means UTF-8, and is REMOVED rather than decoded (as `latin1` it is three visible
//     characters, as `utf-8` a U+FEFF — either way it lands inside the file's first key, and
//     `ï»¿[CmdMove]` matches nothing);
//   • **no BOM, but the file IS valid UTF-8** — every byte, by the strict decoder — means UTF-8
//     too. That is not a guess at a codepage, it is a fact about the bytes, and it is checked
//     with a `fatal` decode so a single malformed sequence settles it.
//
// **Why the sniff cannot regress an install that already read correctly.** A windows-1252 file
// has high bytes that are NOT valid UTF-8 — a German `ü` is one byte, 0xFC, and a lone
// continuation byte is malformed by definition — so it falls through to the codepage exactly as
// before. Pure ASCII is skipped without decoding at all (both codepages agree on it). To be
// misread, a real 1252 file would have to *literally contain* text that is already double-encoded,
// which is a thing that appears in no game file. And a GBK or CP1251 install is likewise invalid
// UTF-8 and so still falls through, still garbled, and still unmeasured — there is no such install
// here to test a rule against.
//
// It is NOT a general localization fix, and it does not claim to be one: it moves the line from
// "a BOM'd UTF-8 install" to "a UTF-8 install".

/** The UTF-8 byte-order mark. */
const UTF8_BOM = [0xef, 0xbb, 0xbf];

/**
 * A `TextDecoder` for a Warcraft III text file — usable exactly like one, so a call site reads
 * `wc3TextDecoder().decode(bytes)` where it used to read `new TextDecoder("windows-1252")…`.
 *
 * `fallback` is the codepage used when the file carries no BOM, and each caller keeps the
 * spelling it already used — `windows-1252` where the text is real text, `latin1` where the file
 * is being read as bytes. **The two spellings are the same decoder**: in the Encoding standard
 * `latin1` and `iso-8859-1` are aliases for windows-1252, so the parameter is kept for the call
 * sites' own readability and not because it changes an answer. `"utf-8"` is for a caller that
 * already said UTF-8 — a `war3map.wts`, the install's own `common.j` — where the BOM still has to
 * be dropped, or it becomes part of the first key.
 */
/** Anything `TextDecoder.decode` takes: a view, or a whole `ArrayBuffer` (what `File.arrayBuffer`
 *  hands back). Normalised to bytes before the BOM is looked for. */
export type Wc3TextBytes = ArrayBuffer | ArrayBufferView;

export function wc3TextDecoder(fallback: "windows-1252" | "latin1" | "utf-8" = "windows-1252"): {
  decode(bytes: Wc3TextBytes): string;
} {
  const plain = new TextDecoder(fallback);
  /** Built on first use, so a file that never needs them pays for none of them. */
  let utf8: TextDecoder | null = null;
  let strict: TextDecoder | null = null;
  return {
    decode(bytes: Wc3TextBytes): string {
      const b =
        bytes instanceof Uint8Array ? bytes
        : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);

      const bom = b.length >= 3 && b[0] === UTF8_BOM[0] && b[1] === UTF8_BOM[1] && b[2] === UTF8_BOM[2];
      if (bom) {
        // The BOM is REMOVED rather than decoded: as `latin1` it is three visible characters and
        // as `utf-8` it is a U+FEFF that becomes part of whatever key the file opens with. And
        // the declaration is the whole point — a file that says it is UTF-8 is read AS UTF-8,
        // whatever codepage this caller would otherwise have used.
        utf8 ??= new TextDecoder("utf-8");
        return utf8.decode(b.subarray(3));
      }

      // No BOM. Most files are pure ASCII, where both codepages agree and the answer is the
      // same and cheap — only a file that actually has a high byte is worth looking at.
      if (!hasHighByte(b)) return plain.decode(b);

      // …and of those, one that is valid UTF-8 throughout IS UTF-8 (see the header). The strict
      // decoder is the test: anything malformed throws, and the codepage keeps the file.
      strict ??= new TextDecoder("utf-8", { fatal: true });
      try {
        const text = strict.decode(b);
        utf8 ??= new TextDecoder("utf-8");
        return text;
      } catch {
        return plain.decode(b);
      }
    },
  };
}

/** Any byte with the top bit set — the only way an 8-bit codepage can differ from ASCII, and the
 *  precondition for the UTF-8 question being worth asking at all. */
function hasHighByte(b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) if (b[i] >= 0x80) return true;
  return false;
}
