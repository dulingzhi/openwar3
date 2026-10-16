// How a Warcraft III text file is decoded, in one place.
//
// Every data file the game reads outside the binary formats — `*.slk`, `*.txt`, `*.fdf`,
// `war3map.wts` — is 8-bit text in the machine's own ANSI codepage, because that is what the
// World Editor wrote in 2002 and what the engine still reads. For the English, German and French
// installs that codepage is windows-1252, which is what this engine assumed for its whole life.
//
// **A LOCALIZED install is the case that assumption misses, and it announces itself.** The
// sampled files of a Simplified-Chinese 1.27 install begin `EF BB BF` — the UTF-8 byte-order
// mark — and the rest of the file is valid UTF-8. Read as windows-1252 those bytes become
// `ï»¿` followed by mojibake, so the main menu reads `å¼€å§‹æ¸¸æˆ` where it should read 开始游戏,
// and — worse than the visible half — the FIRST key of such a file is mis-keyed, because the
// BOM lands inside it: `Units\CommandStrings.txt` opens with `ï»¿[CmdMove]`, and a section
// named that matches nothing.
//
// So the rule is the file's own declaration rather than a guess: **a BOM means UTF-8**, and a
// file without one is read exactly as it was before. That is strictly more correct than the
// alternative (sniffing a codepage from the bytes) and it cannot regress a file that used to
// read correctly — a BOM'd file was already mojibake, so there is nothing to break.
//
// It is NOT a general localization fix. A Chinese or Russian install whose files carry no BOM
// (GBK, CP1251) is still read as windows-1252 and still garbled, and there is no evidence in
// hand of such an install to test a rule against — inventing a heuristic for one would be
// guessing, which is what the prime directive forbids. If one turns up, its BOM-less files belong
// here, decided by something measured rather than assumed.

/** The UTF-8 byte-order mark, which is also the whole of the detection. */
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
  /** Built on first use, so the common BOM-less file pays for one decoder and not two. */
  let utf8: TextDecoder | null = null;
  return {
    decode(bytes: Wc3TextBytes): string {
      const b =
        bytes instanceof Uint8Array ? bytes
        : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);
      const bom = b.length >= 3 && b[0] === UTF8_BOM[0] && b[1] === UTF8_BOM[1] && b[2] === UTF8_BOM[2];
      if (!bom) return plain.decode(b);
      // The BOM is REMOVED rather than decoded: as `latin1` it is three visible characters and as
      // `utf-8` it is a U+FEFF that becomes part of whatever key the file opens with. And the
      // declaration is the whole point — a file that says it is UTF-8 is read AS UTF-8, whatever
      // codepage this caller would otherwise have used.
      utf8 ??= new TextDecoder("utf-8");
      return utf8.decode(b.subarray(3));
    },
  };
}
