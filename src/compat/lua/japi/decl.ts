// The `yd_jass_api` registrations, as data (docs/lua-engine-port.md §6.3-6.4).
//
// Each row is one `jass::japi_add` call in the original plugin, grouped by the source file
// that registers it. The signature is YD's own compact form; `signature.ts` parses it. A row
// whose implementation does not exist yet is still DECLARED: `jass.japi` answers its typed
// default and logs once, which is how a partial port stays honest.

export interface JapiDecl {
  name: string;
  param: string;
}

export const YD_JAPI: readonly JapiDecl[] = [
  // --- UnitState.cpp -------------------------------------------------------------------
  { name: "EXGetUnitString", param: "(II)S" },
  { name: "EXSetUnitString", param: "(IIS)B" },
  { name: "EXGetUnitReal", param: "(II)R" },
  { name: "EXSetUnitReal", param: "(IIR)B" },
  { name: "EXGetUnitInteger", param: "(II)I" },
  { name: "EXSetUnitInteger", param: "(III)B" },
  { name: "EXGetUnitArrayString", param: "(III)S" },
  { name: "EXSetUnitArrayString", param: "(IIIS)B" },
  { name: "EXPauseUnit", param: "(Hunit;B)V" },
  { name: "EXSetUnitCollisionType", param: "(BHunit;I)V" },
  { name: "EXSetUnitMoveType", param: "(Hunit;I)V" },
  { name: "EXSetUnitFacing", param: "(Hunit;R)V" },
  { name: "EXGetObject", param: "(Hhandle;)I" },

  // --- AbilityState.cpp ----------------------------------------------------------------
  { name: "EXGetUnitAbility", param: "(Hunit;I)Hability;" },
  { name: "EXGetUnitAbilityByIndex", param: "(Hunit;I)Hability;" },
  { name: "ExGetUnitSpellAbility", param: "(Hunit;I)Hability;" },
  { name: "EXGetAbilityLevel", param: "(Hability;)I" },
  { name: "EXGetAbilityId", param: "(Hability;)I" },
  { name: "EXGetAbilityState", param: "(Hability;I)R" },
  { name: "EXSetAbilityState", param: "(Hability;IR)B" },
  { name: "EXGetAbilityDataReal", param: "(Hability;II)R" },
  { name: "EXSetAbilityDataReal", param: "(Hability;IIR)B" },
  { name: "EXGetAbilityDataInteger", param: "(Hability;II)I" },
  { name: "EXSetAbilityDataInteger", param: "(Hability;III)B" },
  { name: "EXGetAbilityDataString", param: "(Hability;II)S" },
  { name: "EXSetAbilityDataString", param: "(Hability;IIS)B" },
  { name: "EXSetAbilityAEmeDataA", param: "(Hability;I)B" },
  { name: "EXGetBuffDataString", param: "(II)S" },
  { name: "EXSetBuffDataString", param: "(IIS)B" },
  { name: "EXGetAbilityString", param: "(III)S" },
  { name: "EXSetAbilityString", param: "(IIIS)B" },

  // --- ItemState.cpp -------------------------------------------------------------------
  { name: "EXGetItemDataString", param: "(II)S" },
  { name: "EXSetItemDataString", param: "(IIS)B" },

  // --- EventDamageData.cpp -------------------------------------------------------------
  { name: "EXGetEventDamageData", param: "(I)I" },
  { name: "EXSetEventDamage", param: "(R)B" },

  // --- DisplayChat.cpp -----------------------------------------------------------------
  { name: "EXDisplayChat", param: "(Hplayer;IS)V" },

  // --- Effect.cpp ----------------------------------------------------------------------
  { name: "EXSetEffectXY", param: "(Heffect;RR)V" },
  { name: "EXSetEffectZ", param: "(Heffect;R)V" },
  { name: "EXGetEffectX", param: "(Heffect;)R" },
  { name: "EXGetEffectY", param: "(Heffect;)R" },
  { name: "EXGetEffectZ", param: "(Heffect;)R" },
  { name: "EXSetEffectSize", param: "(Heffect;R)V" },
  { name: "EXGetEffectSize", param: "(Heffect;)R" },
  { name: "EXEffectMatRotateX", param: "(Heffect;R)V" },
  { name: "EXEffectMatRotateY", param: "(Heffect;R)V" },
  { name: "EXEffectMatRotateZ", param: "(Heffect;R)V" },
  { name: "EXEffectMatScale", param: "(Heffect;RRR)V" },
  { name: "EXEffectMatReset", param: "(Heffect;)V" },
  { name: "EXSetEffectSpeed", param: "(Heffect;R)V" },

  // --- DisableButtonBlp.cpp ------------------------------------------------------------
  { name: "EXDclareButtonIcon", param: "(S)V" },
  { name: "EXBlendButtonIcon", param: "(SSS)B" },

  // --- lua_loader.cpp (a JAPI native, not a plugin module) ------------------------------
  { name: "EXExecuteScript", param: "(S)S" },
];

/**
 * The names `yd_jass_api` installs with `japi_hook` rather than `japi_add` (UnitState.cpp:853-854,
 * EventDamageData.cpp:206). They are EXISTING natives whose behaviour it extends, and the hook
 * also files them in `japi_function` — so in the original `jass.japi.GetUnitState` resolves to
 * the same (extended) native `jass.common.GetUnitState` does. We keep that alias here; the
 * implementation itself is the native wrapper installed by host.ts.
 */
export const JAPI_HOOK_ALIASES: readonly JapiDecl[] = [
  { name: "GetUnitState", param: "(Hunit;I)R" },
  { name: "SetUnitState", param: "(Hunit;IR)V" },
  { name: "GetEventDamage", param: "()R" },
];
