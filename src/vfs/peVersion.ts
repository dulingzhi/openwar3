// The version of an MPQ-era Warcraft III, read out of the game executable itself.
//
// A 1.30+ install says which build it is in `.build.info`, one line of text beside the exe
// (src/vfs/casc.ts). The MPQ era has no such file and never had one — the version lives where
// Windows applications have always kept it, in the `VS_VERSION_INFO` resource inside the
// executable, which is also what the real client reports in its own corner of the main menu.
//
// **Which executable is the authority.** `War3.exe`, never `Warcraft III.exe`: in a 1.27 folder
// the latter is the *launcher* — a 274 KB stub whose own version resource reads `1, 0, 0, 1` —
// while `War3.exe` carries the game, and with it the number a patch is named by. Verified against
// the retail 1.27b install: `War3.exe` reports `1.27.0.52240 (f7ba2a3)`. The name is matched
// case-insensitively by the callers; this module only parses bytes.
//
// **Why the fixed file info and not the string table.** The resource carries both a binary
// `VS_FIXEDFILEINFO` (four 16-bit fields) and a per-language string table holding the pretty
// `"1.27.0.52240 (f7ba2a3)"`. The strings are the nicer read, but they are keyed by a language
// ID that varies with the localized install, and a Korean or Chinese 1.27 has its own. The four
// binary fields sit at a fixed offset in the resource and carry the same number, so they are what
// this reads; the trailing `(f7ba2a3)` build hash is not part of the version.
//
// Nothing here is WC3-specific — it is the PE format — but nothing else in OpenWar3 needs it, so
// it lives beside the storage it is used to identify rather than in a general-purpose utility.

/** `IMAGE_DIRECTORY_ENTRY_RESOURCE` — index 2 in the optional header's data directories. */
const RESOURCE_DIRECTORY = 2;
/** `RT_VERSION` — the resource TYPE whose name is the ordinal 16. */
const RT_VERSION = 16;
/** The first four bytes of `VS_FIXEDFILEINFO`, byte-order-marked so a byte scan cannot fake it. */
const VS_FFI_SIGNATURE = 0xfeef04bd;

const u16 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number): number =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/**
 * The version an executable's own `VS_VERSION_INFO` resource states, as `"1.27.0.52240"`, or
 * null when the image carries none, is not a PE, or is truncated.
 *
 * Never throws and never guesses: every read is bounds-checked and any surprise returns null, so
 * a damaged or unexpected executable reads as "this folder does not say which Warcraft III it
 * is" rather than as a wrong version or a crash on the load gate.
 */
export function peFileVersion(bytes: Uint8Array): string | null {
  const fixed = readFixedFileInfo(bytes);
  if (!fixed) return null;
  // ProductVersion is what the launcher and the Add/Remove Programs entry show, and what a patch
  // is named by; FileVersion is the fallback because a stray toolchain sometimes leaves the
  // product fields zero while filling these.
  const [ms, ls] = fixed.productVersion.some((n) => n !== 0) ? fixed.productVersion : fixed.fileVersion;
  if (ms === 0 && ls === 0) return null;
  return `${(ms >>> 16) & 0xffff}.${ms & 0xffff}.${(ls >>> 16) & 0xffff}.${ls & 0xffff}`;
}

interface FixedFileInfo {
  /** `[MS, LS]`, each packing two 16-bit components — major/minor and build/revision. */
  fileVersion: [number, number];
  productVersion: [number, number];
}

/** Walk DOS header → PE header → resource directory → `RT_VERSION` → `VS_FIXEDFILEINFO`. */
function readFixedFileInfo(b: Uint8Array): FixedFileInfo | null {
  if (b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) return null; // "MZ"

  const pe = u32(b, 0x3c);
  if (pe + 24 > b.length || u32(b, pe) !== 0x00004550) return null; // "PE\0\0"

  const sections = u16(b, pe + 6);
  const optionalSize = u16(b, pe + 20);
  const optional = pe + 24;
  if (optional + optionalSize > b.length) return null;

  // 0x10b is PE32, 0x20b is PE32+. The data directories begin after the fixed part of the
  // optional header, which is 28 bytes longer on the 64-bit one.
  const magic = u16(b, optional);
  const dirBase = magic === 0x20b ? optional + 112 : magic === 0x10b ? optional + 96 : -1;
  if (dirBase < 0 || dirBase + 8 > b.length) return null;

  const resourceRva = u32(b, dirBase + RESOURCE_DIRECTORY * 8);
  if (resourceRva === 0) return null;

  // The section table starts right after the optional header and maps an RVA to a file offset.
  const sectionTable = optional + optionalSize;
  const offset = rvaToOffset(b, sectionTable, sections, resourceRva);
  if (offset === null) return null;

  const resource = findVersionResource(b, offset);
  if (!resource) return null;
  const dataOffset = rvaToOffset(b, sectionTable, sections, resource.rva);
  if (dataOffset === null) return null;

  // `VS_VERSIONINFO`: wLength, wValueLength, wType, then the UTF-16 key "VS_VERSION_INFO" padded
  // to a 4-byte boundary — after which the fixed info begins with its own signature.
  const keyEnd = dataOffset + 6 + ("VS_VERSION_INFO".length + 1) * 2;
  const start = (keyEnd + 3) & ~3;
  if (start + 52 > b.length) return null;
  if (u32(b, start) !== VS_FFI_SIGNATURE) return null;

  // dwSignature, dwStrucVersion, dwFileVersionMS, dwFileVersionLS, dwProductVersionMS, dwProductVersionLS
  return {
    fileVersion: [u32(b, start + 8), u32(b, start + 12)],
    productVersion: [u32(b, start + 16), u32(b, start + 20)],
  };
}

/** Translate a relative virtual address into a file offset through the section table. */
function rvaToOffset(b: Uint8Array, sectionTable: number, sections: number, rva: number): number | null {
  for (let i = 0; i < sections; i++) {
    const s = sectionTable + i * 40;
    if (s + 40 > b.length) return null;
    const virtualSize = u32(b, s + 8);
    const virtualAddress = u32(b, s + 12);
    const rawSize = u32(b, s + 16);
    const rawPointer = u32(b, s + 20);
    // A section's in-memory image may be larger than what it stores on disk; an RVA inside the
    // virtual tail has no file bytes behind it, so it is not a hit.
    if (rva >= virtualAddress && rva < virtualAddress + Math.max(virtualSize, rawSize)) {
      const within = rva - virtualAddress;
      if (within >= rawSize) return null;
      return rawPointer + within;
    }
  }
  return null;
}

/**
 * The first `RT_VERSION` resource in the directory, as the RVA of its data entry.
 *
 * Three levels: type (`RT_VERSION`), then name/ID, then language. The lower two are walked for
 * whichever entry comes FIRST rather than for the ID `1` and the `0x409` language — an executable
 * numbers and localizes its version resource as its toolchain pleases, and there is normally only
 * one of each, so naming them would be an assumption with nothing to gain.
 */
function findVersionResource(b: Uint8Array, root: number): { rva: number } | null {
  const type = findEntry(b, root, root, (id, name) => name === null && id === RT_VERSION);
  if (type === null) return null;
  const name = firstChild(b, root, type);
  if (name === null) return null;
  // A leaf entry carries the high bit CLEAR and points at an `IMAGE_RESOURCE_DATA_ENTRY`; a set
  // bit means another directory. The language level is the leaf in the standard three-level
  // shape, but a resource that stops at the name level is legal too, so both are accepted.
  const leaf = name.isDirectory ? firstChild(b, root, name.at) : name;
  if (leaf === null || leaf.isDirectory) return null;
  if (leaf.at + 16 > b.length) return null;
  const rva = u32(b, leaf.at); // OffsetToData
  return rva === 0 ? null : { rva };
}

/**
 * One level of `IMAGE_RESOURCE_DIRECTORY`, matched by predicate. Returns the child's offset.
 *
 * **`root` is threaded through every level and is not the same as `dir`.** Both the child offset
 * below and a named entry's string offset are relative to the START of the whole resource
 * directory, not to the directory holding the entry — the one thing about this format that looks
 * like an ordinary relative pointer and is not. Resolving them against `dir` walks into the
 * middle of a sibling and reads a plausible-looking directory header out of unrelated bytes.
 */
function findEntry(
  b: Uint8Array,
  root: number,
  dir: number,
  match: (id: number, name: string | null) => boolean,
): number | null {
  const at = directoryEntries(b, dir);
  if (at === null) return null;
  const named = u16(b, dir + 12);
  const total = named + u16(b, dir + 14);
  for (let i = 0; i < total; i++) {
    const entry = at + i * 8;
    const idOrName = u32(b, entry);
    const isName = (idOrName & 0x80000000) !== 0;
    if (match(idOrName & 0x7fffffff, isName ? nameAt(b, root, idOrName & 0x7fffffff) : null)) {
      return root + (u32(b, entry + 4) & 0x7fffffff);
    }
  }
  return null;
}

/** The first entry of a level: where it points, and whether that is a further subdirectory. */
function firstChild(b: Uint8Array, root: number, dir: number): { at: number; isDirectory: boolean } | null {
  const at = directoryEntries(b, dir);
  if (at === null) return null;
  if (u16(b, dir + 12) + u16(b, dir + 14) === 0) return null;
  const offset = u32(b, at + 4);
  return { at: root + (offset & 0x7fffffff), isDirectory: (offset & 0x80000000) !== 0 };
}

/** Where a directory's entry array begins, or null when the directory header does not fit. */
function directoryEntries(b: Uint8Array, dir: number): number | null {
  return dir + 16 <= b.length ? dir + 16 : null;
}

/** A named entry's string, relative to the resource directory's own base. */
function nameAt(b: Uint8Array, root: number, offset: number): string {
  const at = root + offset;
  if (at + 2 > b.length) return "";
  const length = u16(b, at);
  let out = "";
  for (let i = 0; i < length; i++) {
    const c = at + 2 + i * 2;
    if (c + 2 > b.length) break;
    out += String.fromCharCode(u16(b, c));
  }
  return out;
}
