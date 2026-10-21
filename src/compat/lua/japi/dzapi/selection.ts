import type { JassUnit, NativeCtx, Runtime } from "../../../../jass/runtime";
import { asStr, jInt, JNULL, type JassValue } from "../../../../jass/values";

// DzAPI P1: local selection and per-unit minimap glyphs (docs/dzapi-port.md §3.3;
// war3japi_plus.cpp:953-1184).
//
// The selection hooks return HANDLES (Runtime.unitForSim), so these are pure conversions.
// `DzWidgetSetMinimapIcon` names a path; the minimap view stamps it at the unit's explored
// position instead of the team dot.

type Impl = (ctx: NativeCtx, args: JassValue[]) => JassValue;
const selection = (rt: Runtime): JassValue[] => rt.hooks?.localSelection?.() ?? [];
const simOf = (rt: Runtime, v: JassValue | undefined): number => {
  const u = rt.data<JassUnit>(v ?? JNULL);
  return u && u.simId >= 0 ? u.simId : -1;
};

export function selectionImpls(rt: Runtime): Record<string, Impl> {
  return {
    DzGetLocalSelectUnitCount: () => jInt(selection(rt).length),
    DzGetLocalSelectUnit: (_c, a) => {
      const s = selection(rt);
      const i = Number(a[0]?.k === "int" ? a[0].n : 0);
      return s[i] ?? JNULL;
    },
    DzGetSelectedLeaderUnit: () => rt.hooks?.localLeader?.() ?? JNULL,

    DzWidgetSetMinimapIcon: (_c, a) => {
      const id = simOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setWidgetMinimapIcon?.(id, asStr(a[1] ?? JNULL));
      return JNULL;
    },
    DzWidgetSetMinimapIconEnable: (_c, a) => {
      const id = simOf(rt, a[0]);
      if (id >= 0) rt.hooks?.setWidgetMinimapIconEnabled?.(id, a[1]?.k === "bool" ? a[1].b : false);
      return JNULL;
    },
  };
}
