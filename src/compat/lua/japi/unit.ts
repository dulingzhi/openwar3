import type { JassUnit, Runtime } from "../../../jass/runtime";
import { intToRawcode } from "../../../jass/lexer";
import { asInt, asNum, jBool, jInt, jReal, jStr, JNULL, type JassValue } from "../../../jass/values";
import type { JapiImpl } from "./registry";

// The `UnitState.cpp` half of pack A (docs/lua-engine-port.md §6.3).
//
// Two different questions share this file:
//
//   * the TYPE accessors (`EXGet/SetUnit{Integer,Real,String,ArrayString}`) read the shared
//     unit-type row. We answer only the two string arrays YDWE's own UI helpers use — 10 Name,
//     61 Proper Names (KKAPI.j) — and refuse every write, because the registry row is shared by
//     the whole page;
//   * the INSTANCE helpers pause/facing read and write the unit the handle names.
//
// `GetUnitState`/`SetUnitState` themselves are extended in host.ts, where the original natives
// live; the hook table is the only route from there into the sim.

const simOf = (rt: Runtime, v: JassValue | undefined): number | undefined => {
  const u = rt.data<JassUnit>(v ?? JNULL);
  return u && u.simId >= 0 ? u.simId : undefined;
};
const typeOf = (v: JassValue | undefined): string => intToRawcode(asInt(v ?? JNULL));

export function unitImpls(rt: Runtime): Record<string, JapiImpl> {
  return {
    // --- TYPE data -----------------------------------------------------------------------
    EXGetUnitString: (_c, args) => {
      const v = rt.hooks?.getUnitTypeStringSlot?.(typeOf(args[0]), asInt(args[1] ?? JNULL), 0);
      if (v === undefined) rt.warnOnce(`japi:EXGetUnitString:${asInt(args[1] ?? JNULL)}`, "no such type slot — empty");
      return jStr(v ?? "");
    },
    EXSetUnitString: () => jBool(false),

    EXGetUnitReal: (_c, args) => {
      rt.warnOnce(`japi:EXGetUnitReal:${asInt(args[1] ?? JNULL)}`, "type real slots are not answered — 0");
      return jReal(0);
    },
    EXSetUnitReal: () => jBool(false),

    EXGetUnitInteger: (_c, args) => {
      const v = rt.hooks?.getUnitTypeCount?.(typeOf(args[0]), asInt(args[1] ?? JNULL));
      if (v === undefined) rt.warnOnce(`japi:EXGetUnitInteger:${asInt(args[1] ?? JNULL)}`, "no such type slot — 0");
      return jInt(v ?? 0);
    },
    EXSetUnitInteger: () => jBool(false),

    EXGetUnitArrayString: (_c, args) => {
      const v = rt.hooks?.getUnitTypeStringSlot?.(typeOf(args[0]), asInt(args[1] ?? JNULL), asInt(args[2] ?? JNULL));
      return jStr(v ?? "");
    },
    EXSetUnitArrayString: () => jBool(false),

    // --- INSTANCE helpers ----------------------------------------------------------------
    EXPauseUnit: (_c, args) => {
      const id = simOf(rt, args[0]);
      if (id !== undefined) rt.hooks?.pauseUnit?.(id, args[1]?.k === "bool" ? args[1].b : false);
      return JNULL;
    },
    EXSetUnitFacing: (_c, args) => {
      const id = simOf(rt, args[0]);
      if (id !== undefined) rt.hooks?.setUnitFacing?.(id, (asNum(args[1] ?? JNULL) * Math.PI) / 180, true);
      return JNULL;
    },
    EXSetUnitMoveType: () => {
      rt.warnOnce("japi:EXSetUnitMoveType", "per-unit move-type override is not wired yet");
      return JNULL;
    },
    EXSetUnitCollisionType: () => {
      rt.warnOnce("japi:EXSetUnitCollisionType", "collision-bit masks are not wired yet");
      return JNULL;
    },
    EXGetObject: () => {
      rt.warnOnce("japi:EXGetObject", "there is no process pointer to return");
      return jInt(0);
    },
  };
}
