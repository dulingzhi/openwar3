import type { JassUnit, NativeCtx, Runtime } from "../../../../jass/runtime";
import { asNum, asStr, type JassValue, JNULL } from "../../../../jass/values";

// DzAPI P1: per-UNIT object-data overrides (docs/dzapi-port.md §3.4; war3japi_db.cpp).
//
// Name/ProperName use the runtime's existing `setUnitName`; the rest go through
// `setUnitDbField`, which stores them on the SimUnit for the info panel/renderer. They are
// PER UNIT, not a type-table edit, which is exactly what the original's UnitDB cache does.

type Impl = (ctx: NativeCtx, args: JassValue[]) => JassValue;

export function unitDbImpls(rt: Runtime): Record<string, Impl> {
  const simOf = (v: JassValue | undefined): number | undefined => {
    const u = rt.data<JassUnit>(v ?? JNULL);
    return u && u.simId >= 0 ? u.simId : undefined;
  };
  const strSet = (field: string): Impl => (_c, a) => {
    const id = simOf(a[0]);
    if (id !== undefined) rt.hooks?.setUnitDbField?.(id, field, asStr(a[1] ?? JNULL));
    return JNULL;
  };
  const realSet = (field: string): Impl => (_c, a) => {
    const id = simOf(a[0]);
    if (id !== undefined) rt.hooks?.setUnitDbField?.(id, field, asNum(a[1] ?? JNULL));
    return JNULL;
  };
  const boolSet = (field: string): Impl => (_c, a) => {
    const id = simOf(a[0]);
    if (id !== undefined) rt.hooks?.setUnitDbField?.(id, field, a[1]?.k === "bool" ? a[1].b : false);
    return JNULL;
  };

  return {
    DzSetUnitName: (_c, a) => {
      const id = simOf(a[0]);
      if (id !== undefined) rt.hooks?.setUnitName?.(id, asStr(a[1] ?? JNULL), false);
      return JNULL;
    },
    DzSetUnitProperName: (_c, a) => {
      const id = simOf(a[0]);
      if (id !== undefined) rt.hooks?.setUnitName?.(id, asStr(a[1] ?? JNULL), true);
      return JNULL;
    },
    DzSetUnitPortrait: strSet("portrait"),
    DzSetUnitDescription: strSet("description"),
    DzSetUnitCollisionSize: realSet("collisionSize"),
    DzSetUnitMissileModel: strSet("missileModel"),
    DzSetUnitMissileArc: realSet("missileArc"),
    DzSetUnitMissileSpeed: realSet("missileSpeed"),
    DzSetUnitMissileHoming: boolSet("missileHoming"),
    DzSetUnitPreselectUIVisible: boolSet("preselectUIVisible"),
  };
}
