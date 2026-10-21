import type { Runtime } from "../../../jass/runtime";
import { asNum, jReal, JNULL, type JassValue } from "../../../jass/values";
import type { JapiImpl } from "./registry";

// The Effect.cpp half (docs/lua-engine-port.md §6.3; yd_jass_api/Effect.cpp).
//
// The renderer already owns the effect model and its transform (the BlzSetSpecialEffect family
// landed in pass 10). These are the YD spellings over four new hooks: a scale GETTER, a
// per-axis scale, an incremental axis rotation and a playback rate.
//
// The angles are DEGREES, as the original's `* (M_PI / 180)` on each of the Rotate calls shows;
// `angle` in the demo maps is routinely `4.00 * t` and `t + 90`.

const engineIdOf = (rt: Runtime, v: JassValue | undefined): number => {
  const e = rt.data<{ engineId?: unknown }>(v ?? JNULL);
  return e && typeof e.engineId === "number" ? e.engineId : -1;
};

export function effectImpls(rt: Runtime): Record<string, JapiImpl> {
  const position = (id: number) => rt.hooks?.specialEffectPosition?.(id) ?? null;

  return {
    EXGetEffectX: (_c, a) => jReal(position(engineIdOf(rt, a[0]))?.x ?? 0),
    EXGetEffectY: (_c, a) => jReal(position(engineIdOf(rt, a[0]))?.y ?? 0),
    EXGetEffectZ: (_c, a) => jReal(position(engineIdOf(rt, a[0]))?.z ?? 0),

    EXSetEffectXY: (_c, a) => {
      const id = engineIdOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setSpecialEffectPosition?.(id, asNum(a[1] ?? JNULL), asNum(a[2] ?? JNULL), null);
      return JNULL;
    },
    EXSetEffectZ: (_c, a) => {
      const id = engineIdOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setSpecialEffectPosition?.(id, null, null, asNum(a[1] ?? JNULL));
      return JNULL;
    },

    EXGetEffectSize: (_c, a) => jReal(rt.hooks?.specialEffectScale?.(engineIdOf(rt, a[0])) ?? 0),
    EXSetEffectSize: (_c, a) => {
      const id = engineIdOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setSpecialEffectScale?.(id, asNum(a[1] ?? JNULL));
      return JNULL;
    },

    EXEffectMatRotateX: (_c, a) => {
      const id = engineIdOf(rt, a[0]);
      if (id >= 0) rt.hooks?.rotateSpecialEffect?.(id, "x", (asNum(a[1] ?? JNULL) * Math.PI) / 180);
      return JNULL;
    },
    EXEffectMatRotateY: (_c, a) => {
      const id = engineIdOf(rt, a[0]);
      if (id >= 0) rt.hooks?.rotateSpecialEffect?.(id, "y", (asNum(a[1] ?? JNULL) * Math.PI) / 180);
      return JNULL;
    },
    EXEffectMatRotateZ: (_c, a) => {
      const id = engineIdOf(rt, a[0]);
      if (id >= 0) rt.hooks?.rotateSpecialEffect?.(id, "z", (asNum(a[1] ?? JNULL) * Math.PI) / 180);
      return JNULL;
    },
    EXEffectMatScale: (_c, a) => {
      const id = engineIdOf(rt, a[0]);
      if (id >= 0) {
        rt.hooks?.setSpecialEffectScaleVector?.(
          id, asNum(a[1] ?? JNULL), asNum(a[2] ?? JNULL), asNum(a[3] ?? JNULL),
        );
      }
      return JNULL;
    },
    EXEffectMatReset: (_c, a) => {
      const id = engineIdOf(rt, a[0]);
      if (id >= 0) rt.hooks?.resetSpecialEffect?.(id);
      return JNULL;
    },
    EXSetEffectSpeed: (_c, a) => {
      const id = engineIdOf(rt, a[0]);
      if (id >= 0) rt.hooks?.specialEffectTimeScale?.(id, asNum(a[1] ?? JNULL));
      return JNULL;
    },
  };
}
