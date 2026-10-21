import type { AbilityInstanceRef, Runtime } from "../../../jass/runtime";
import { intToRawcode, rawcodeToInt } from "../../../jass/lexer";
import { asInt, asNum, asStr, jBool, jInt, jReal, jStr, JNULL, type JassValue } from "../../../jass/values";
import type { JapiImpl } from "./registry";

// EXGetUnitAbility / EXGetAbility* (docs/lua-engine-port.md §6.3; yd_jass_api/AbilityState.cpp).
//
// The 1.31 instance API already exists (`BlzGetUnitAbility`, the interned AbilityInstanceRef),
// so the handle-taking half DELEGATES to it through `ctx.call` rather than minting a second
// kind of ability handle. The data half reads one AbilityDef through an EngineHooks seam,
// keyed by YDWE's own documented ids (YDWEAbilityState.j). A field we cannot answer is
// declared-not-answered by the hook returning undefined; the typed default goes back.

interface AbilityPayload extends AbilityInstanceRef {
  handleId: number;
}

const refOf = (rt: Runtime, v: JassValue | undefined): AbilityPayload | undefined => {
  const a = rt.data<AbilityPayload>(v ?? JNULL);
  return a && typeof a.abilId === "string" ? a : undefined;
};

export function abilityImpls(rt: Runtime): Record<string, JapiImpl> {
  const read = (ref: AbilityInstanceRef, level: number, dataType: number) =>
    rt.hooks?.abilityDataField?.(ref, level, dataType);
  const write = (ref: AbilityInstanceRef, level: number, dataType: number, value: number | string): boolean =>
    rt.hooks?.setAbilityDataField?.(ref, level, dataType, value) ?? false;

  const levelOf = (ref: AbilityPayload, explicit?: JassValue): number => {
    if (explicit !== undefined) return Math.max(1, asInt(explicit));
    return ref.kind === "unit" ? Math.max(1, rt.hooks?.getUnitAbilityLevel?.(ref.owner, ref.abilId) ?? 1) : 1;
  };

  return {
    // --- the instance --------------------------------------------------------------------
    EXGetUnitAbility: (ctx, args) => ctx.call("BlzGetUnitAbility", args),
    EXGetUnitAbilityByIndex: (ctx, args) => ctx.call("BlzGetUnitAbilityByIndex", args),
    ExGetUnitSpellAbility: (ctx, args) => ctx.call("BlzGetUnitAbilityByIndex", args),

    EXGetAbilityId: (_c, args) => {
      const ref = refOf(rt, args[0]);
      return ref ? jInt(rawcodeToInt(ref.abilId)) : jInt(0);
    },

    EXGetAbilityLevel: (_c, args) => {
      const ref = refOf(rt, args[0]);
      return jInt(ref ? levelOf(ref) : 0);
    },

    // ABILITY_STATE_COOLDOWN = 1 (the only state YDWE documents).
    EXGetAbilityState: (_c, args) => {
      const ref = refOf(rt, args[0]);
      const state = asInt(args[1] ?? JNULL);
      if (!ref || state !== 1 || ref.kind !== "unit") return jReal(0);
      return jReal(rt.hooks?.unitAbilityCooldownLeft?.(ref.owner, ref.abilId) ?? 0);
    },

    EXSetAbilityState: (_c, args) => {
      const ref = refOf(rt, args[0]);
      const state = asInt(args[1] ?? JNULL);
      const value = asNum(args[2] ?? JNULL);
      if (!ref || state !== 1 || ref.kind !== "unit" || !rt.hooks?.startUnitAbilityCooldown) return jBool(false);
      rt.hooks.startUnitAbilityCooldown(ref.owner, ref.abilId, value);
      return jBool(true);
    },

    // --- ABILITY_DATA_* 100-116 / 200-220 ------------------------------------------------
    EXGetAbilityDataReal: (_c, args) => {
      const ref = refOf(rt, args[0]);
      if (!ref) return jReal(0);
      const v = read(ref, levelOf(ref, args[1]), asInt(args[2] ?? JNULL));
      return jReal(typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : v ? 1 : 0);
    },
    EXSetAbilityDataReal: (_c, args) => {
      const ref = refOf(rt, args[0]);
      return jBool(!!ref && write(ref, levelOf(ref, args[1]), asInt(args[2] ?? JNULL), asNum(args[3] ?? JNULL)));
    },

    EXGetAbilityDataInteger: (_c, args) => {
      const ref = refOf(rt, args[0]);
      if (!ref) return jInt(0);
      const v = read(ref, levelOf(ref, args[1]), asInt(args[2] ?? JNULL));
      if (typeof v === "number") return jInt(Math.trunc(v));
      if (typeof v === "boolean") return jInt(v ? 1 : 0);
      if (typeof v === "string") return jInt(v.length === 4 ? rawcodeToInt(v) : Number(v) | 0);
      return jInt(0);
    },
    EXSetAbilityDataInteger: (_c, args) => {
      const ref = refOf(rt, args[0]);
      return jBool(!!ref && write(ref, levelOf(ref, args[1]), asInt(args[2] ?? JNULL), asInt(args[3] ?? JNULL)));
    },

    EXGetAbilityDataString: (_c, args) => {
      const ref = refOf(rt, args[0]);
      if (!ref) return jStr("");
      const v = read(ref, levelOf(ref, args[1]), asInt(args[2] ?? JNULL));
      return jStr(typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
    },
    EXSetAbilityDataString: (_c, args) => {
      const ref = refOf(rt, args[0]);
      return jBool(!!ref && write(ref, levelOf(ref, args[1]), asInt(args[2] ?? JNULL), asStr(args[3] ?? JNULL)));
    },

    // EXGet/SetAbilityString take a CODE and a level instead of a handle. The hook only reads
    // `abilId`, so an owner-less instance is enough.
    EXGetAbilityString: (_c, args) => {
      const code = intToRawcode(asInt(args[0] ?? JNULL));
      const level = Math.max(1, asInt(args[1] ?? JNULL));
      const v = rt.hooks?.abilityDataField?.({ kind: "unit", owner: -1, abilId: code }, level, asInt(args[2] ?? JNULL));
      return jStr(typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
    },
    // The metamorphosis hack (YDWEUnitTransform): the "normal form unit" is DataA.
    // `EXSetAbilityAEmeUnitID` is the same call under the spelling some demo maps declare.
    EXSetAbilityAEmeDataA: (_c, args) => {
      const ref = refOf(rt, args[0]);
      return jBool(!!ref && write(ref, 1, 108, asInt(args[1] ?? JNULL)));
    },
    EXSetAbilityAEmeUnitID: (_c, args) => {
      const ref = refOf(rt, args[0]);
      return jBool(!!ref && write(ref, 1, 108, asInt(args[1] ?? JNULL)));
    },

    EXSetAbilityString: (_c, args) => {
      const code = intToRawcode(asInt(args[0] ?? JNULL));
      const level = Math.max(1, asInt(args[1] ?? JNULL));
      return jBool(rt.hooks?.setAbilityDataField?.({ kind: "unit", owner: -1, abilId: code }, level, asInt(args[2] ?? JNULL), asStr(args[3] ?? JNULL)) ?? false);
    },
  };
}
