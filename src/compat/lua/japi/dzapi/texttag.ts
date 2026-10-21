import type { NativeCtx, Runtime, TextTagObj } from "../../../../jass/runtime";
import { asInt, asStr, jInt, jStr, JNULL, type JassValue } from "../../../../jass/values";

// DzAPI P1: text tags (docs/dzapi-port.md §3.2; war3japi_extend.cpp:19-129).
//
// `DzTextTagGet/SetFont` is a GLOBAL setting in the original (the font of the text-tag
// manager), not a per-tag field — hence the `textTagFont` hook. StartAlpha and ShadowColor are
// per tag and live on TextTagObj.

type Impl = (ctx: NativeCtx, args: JassValue[]) => JassValue;
const tagOf = (rt: Runtime, v: JassValue | undefined): TextTagObj | undefined =>
  rt.data<TextTagObj>(v ?? JNULL);

export function textTagImpls(rt: Runtime): Record<string, Impl> {
  return {
    DzTextTagGetFont: () => jStr(rt.hooks?.textTagFont?.() ?? ""),
    DzTextTagSetFont: (_c, a) => {
      rt.hooks?.setTextTagFont?.(asStr(a[0] ?? JNULL));
      return JNULL;
    },
    DzTextTagGetStartAlpha: (_c, a) => jInt(tagOf(rt, a[0])?.startAlpha ?? 0),
    DzTextTagSetStartAlpha: (_c, a) => {
      const tt = tagOf(rt, a[0]);
      if (tt) tt.startAlpha = asInt(a[1] ?? JNULL) & 0xff;
      return JNULL;
    },
    DzTextTagGetShadowColor: (_c, a) => jInt(tagOf(rt, a[0])?.shadowColor ?? 0),
    DzTextTagSetShadowColor: (_c, a) => {
      const tt = tagOf(rt, a[0]);
      if (tt) tt.shadowColor = asInt(a[1] ?? JNULL) | 0;
      return JNULL;
    },
  };
}
