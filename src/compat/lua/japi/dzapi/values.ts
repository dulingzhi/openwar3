import type { NativeCtx, Runtime } from "../../../../jass/runtime";
import { asInt, asStr, jBool, jHandle, jInt, jStr, JNULL, type JassValue } from "../../../../jass/values";

// DzAPI P1: strings, bits and groups (docs/dzapi-port.md §3.1).
//
// The semantics are the plugin's own (war3japi_extend.cpp:449-760). Two deliberate notes:
//   * `DzStringContains` case-insensitive is implemented as a SUBSTRING search, although the
//     source calls `find_first_of` (a character-set search) in that branch. The function's name
//     and its case-sensitive branch both mean "contains"; reproducing the typo would make a
//     map's `DzStringContains("abc", "bc", false)` fail.
//   * `DzStringReplace` with an empty needle returns the input unchanged; the C++ loop would
//     never advance.

type Impl = (ctx: NativeCtx, args: JassValue[]) => JassValue;
const S = (v: JassValue | undefined): string => asStr(v ?? JNULL);
const I = (v: JassValue | undefined): number => asInt(v ?? JNULL);
const B = (v: JassValue | undefined): boolean => (v?.k === "bool" ? v.b : false);
const WS = /^[\t\n\v\f\r ]+/;
const WS_END = /[\t\n\v\f\r ]+$/;

const fold = (s: string, cs: boolean): string => (cs ? s : s.toLowerCase());

/** `std::string::find` family → a JASS index, or -1 for `npos`. */
const indexOrMinus1 = (n: number): number => (n < 0 ? -1 : n);

export function valueImpls(rt: Runtime): Record<string, Impl> {
  return {
    DzStringContains: (_c, a) => jBool(fold(S(a[0]), B(a[2])).includes(fold(S(a[1]), B(a[2])))),
    DzStringFind: (_c, a) =>
      jInt(indexOrMinus1(fold(S(a[0]), B(a[3])).indexOf(fold(S(a[1]), B(a[3])), Math.max(0, I(a[2]))))),

    DzStringFindFirstOf: (_c, a) => {
      const s = fold(S(a[0]), B(a[3])), set = fold(S(a[1]), B(a[3])), off = Math.max(0, I(a[2]));
      for (let i = off; i < s.length; i++) if (set.includes(s[i])) return jInt(i);
      return jInt(-1);
    },
    DzStringFindFirstNotOf: (_c, a) => {
      const s = fold(S(a[0]), B(a[3])), set = fold(S(a[1]), B(a[3])), off = Math.max(0, I(a[2]));
      for (let i = off; i < s.length; i++) if (!set.includes(s[i])) return jInt(i);
      return jInt(-1);
    },
    // `find_last_of(set, offset)` searches BACKWARDS from `offset` INCLUSIVE (std::string).
    DzStringFindLastOf: (_c, a) => {
      const s = fold(S(a[0]), B(a[3])), set = fold(S(a[1]), B(a[3]));
      const from = Math.min(I(a[2]), s.length - 1);
      for (let i = from; i >= 0; i--) if (set.includes(s[i])) return jInt(i);
      return jInt(-1);
    },
    DzStringFindLastNotOf: (_c, a) => {
      const s = fold(S(a[0]), B(a[3])), set = fold(S(a[1]), B(a[3]));
      const from = Math.min(I(a[2]), s.length - 1);
      for (let i = from; i >= 0; i--) if (!set.includes(s[i])) return jInt(i);
      return jInt(-1);
    },

    DzStringTrimLeft: (_c, a) => jStr(S(a[0]).replace(WS, "")),
    DzStringTrimRight: (_c, a) => jStr(S(a[0]).replace(WS_END, "")),
    DzStringTrim: (_c, a) => jStr(S(a[0]).replace(WS, "").replace(WS_END, "")),

    DzStringReverse: (_c, a) => jStr(Array.from(S(a[0])).reverse().join("")),

    DzStringReplace: (_c, a) => {
      const src = S(a[0]), needle = S(a[1]), repl = S(a[2]), cs = B(a[3]);
      if (!needle) return jStr(src);
      if (cs) return jStr(src.split(needle).join(repl));
      // The source lowercases the haystack and the needle, finds positions there, and replaces
      // in the ORIGINAL at those positions. The lengths are equal for ASCII, so positions align.
      const hs = src.toLowerCase(), hn = needle.toLowerCase();
      let out = "", at = 0;
      for (;;) {
        const p = hs.indexOf(hn, at);
        if (p < 0) { out += src.slice(at); break; }
        out += src.slice(at, p) + repl;
        at = p + needle.length;
      }
      return jStr(out);
    },
    DzStringInsert: (_c, a) => {
      const s = S(a[0]), at = Math.max(0, Math.min(s.length, I(a[1])));
      return jStr(s.slice(0, at) + S(a[2]) + s.slice(at));
    },

    // --- bitwise (the source's DWORD operations) --------------------------------------
    DzBitGet: (_c, a) => jInt((I(a[0]) >>> (I(a[1]) & 31)) & 1),
    DzBitSet: (_c, a) => jInt((I(a[0]) & ~(1 << (I(a[1]) & 31))) | ((I(a[2]) & 1) << (I(a[1]) & 31))),
    DzBitGetByte: (_c, a) => jInt((I(a[0]) >>> ((I(a[1]) & 3) * 8)) & 0xff),
    DzBitSetByte: (_c, a) => {
      const n = (I(a[1]) & 3) * 8;
      return jInt((I(a[0]) & ~(0xff << n)) | ((I(a[2]) & 0xff) << n));
    },
    DzBitNot: (_c, a) => jInt(~I(a[0])),
    DzBitAnd: (_c, a) => jInt(I(a[0]) & I(a[1])),
    DzBitOr: (_c, a) => jInt(I(a[0]) | I(a[1])),
    DzBitXor: (_c, a) => jInt(I(a[0]) ^ I(a[1])),
    DzBitShiftLeft: (_c, a) => jInt(I(a[0]) << (I(a[1]) & 31)),
    DzBitShiftRight: (_c, a) => jInt(I(a[0]) >>> (I(a[1]) & 31)),
    // MAKEFOURCC is LITTLE-ENDIAN: byte1 is the low byte.
    DzBitToInt: (_c, a) =>
      jInt((I(a[0]) & 0xff) | ((I(a[1]) & 0xff) << 8) | ((I(a[2]) & 0xff) << 16) | ((I(a[3]) & 0xff) << 24)),

    // --- groups -------------------------------------------------------------------------
    DzGroupGetCount: (_c, a) => {
      const g = rt.data<{ units?: Set<number> }>(a[0] ?? JNULL);
      return jInt(g?.units?.size ?? 0);
    },
    DzGroupGetUnitAt: (_c, a) => {
      const g = rt.data<{ units?: Set<number> }>(a[0] ?? JNULL);
      const units = g?.units ? [...g.units] : [];
      const u = units[I(a[1])];
      return typeof u === "number" ? jHandle(u, "unit") : JNULL;
    },
  };
}
