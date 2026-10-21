import type { JassUnit, NativeCtx, Runtime } from "../../../../jass/runtime";
import { asInt, asNum, asStr, jInt, JNULL, type JassValue } from "../../../../jass/values";

// DzAPI P1: the effect extras (docs/dzapi-port.md §3.4; war3japi_plus.cpp:650-911).
//
// These are the YD spellings over the effect-instance hooks: position, vertex colour/alpha,
// scale, visibility, model swap, clip-by-index, bind/unbind and team colour. `DzSetEffectPos`
// deliberately ignores Z, as the source does (`float* /*z*/`).

type Impl = (ctx: NativeCtx, args: JassValue[]) => JassValue;
const idOf = (rt: Runtime, v: JassValue | undefined): number => {
  const e = rt.data<{ engineId?: unknown }>(v ?? JNULL);
  return e && typeof e.engineId === "number" ? e.engineId : -1;
};

export function effectImpls(rt: Runtime): Record<string, Impl> {
  return {
    DzSetEffectPos: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setSpecialEffectPosition?.(id, asNum(a[1] ?? JNULL), asNum(a[2] ?? JNULL), null);
      return JNULL;
    },
    DzSetEffectScale: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setSpecialEffectScale?.(id, asNum(a[1] ?? JNULL));
      return JNULL;
    },
    DzSetEffectVisible: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setSpecialEffectVisible?.(id, a[1]?.k === "bool" ? a[1].b : false);
      return JNULL;
    },
    DzSetEffectModel: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setSpecialEffectModel?.(id, asStr(a[1] ?? JNULL));
      return JNULL;
    },
    DzSetEffectAnimation: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setSpecialEffectSequence?.(id, asInt(a[1] ?? JNULL), asInt(a[2] ?? JNULL));
      return JNULL;
    },
    DzPlayEffectAnimation: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id < 0) return JNULL;
      const anim = asStr(a[1] ?? JNULL);
      if (anim) rt.hooks?.playSpecialEffect?.(id, anim);
      const link = asStr(a[2] ?? JNULL);
      for (const tag of link.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)) {
        rt.hooks?.specialEffectSubAnim?.(id, tag, true);
      }
      return JNULL;
    },
    DzSetEffectVertexColor: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id < 0) return JNULL;
      const c = asInt(a[1] ?? JNULL);
      rt.hooks?.setSpecialEffectColor?.(id, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
      return JNULL;
    },
    DzSetEffectVertexAlpha: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setSpecialEffectAlpha?.(id, asInt(a[1] ?? JNULL) & 0xff);
      return JNULL;
    },
    DzGetEffectVertexColor: (_c, a) => jInt(rt.hooks?.specialEffectColor?.(idOf(rt, a[0])) ?? 0),
    DzGetEffectVertexAlpha: (_c, a) => jInt(rt.hooks?.specialEffectAlpha?.(idOf(rt, a[0])) ?? 0),
    DzSetEffectTeamColor: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id < 0) return JNULL;
      const player = asInt(a[1] ?? JNULL);
      rt.hooks?.setSpecialEffectTeamColor?.(id, rt.hooks?.playerColor?.(player) ?? player);
      return JNULL;
    },
    DzBindEffect: (_c, a) => {
      const widget = rt.data<JassUnit>(a[0] ?? JNULL);
      const id = idOf(rt, a[2]);
      if (!widget || widget.simId < 0 || id < 0) return JNULL;
      const attach = asStr(a[1] ?? JNULL).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      rt.hooks?.bindSpecialEffect?.(id, widget.simId, attach);
      return JNULL;
    },
    DzUnbindEffect: (_c, a) => {
      const id = idOf(rt, a[0]);
      if (id >= 0) rt.hooks?.unbindSpecialEffect?.(id);
      return JNULL;
    },
  };
}
