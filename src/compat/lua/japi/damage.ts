import { ATTACK_TYPES } from "../../../data/unitFieldCodes";
import type { Runtime } from "../../../jass/runtime";
import { asInt, asNum, jBool, jInt, JNULL } from "../../../jass/values";
import type { JapiImpl } from "./registry";

// `EXGetEventDamageData` / `EXSetEventDamage` (docs/lua-engine-port.md §6.3;
// yd_jass_api/EventDamageData.cpp:144-208).
//
// The seven ids are the ones YDWE's own header documents (YDWEEventDamageData.j):
//   0 valid, 1 physical, 2 is-attack, 3 is-ranged, 4 damage-type, 5 weapon-type, 6 attack-type.
//
// The blow is `Runtime.damageStack`'s top frame — the SAME object `GetEventDamage` and
// `BlzSetEventDamage` read and write, so a map that mixes the two families changes one blow.
// The three flag fields were added to `DamageBlow` by this step; the sim fills them where it
// raises the blow and nowhere else.

export function damageImpls(rt: Runtime): Record<string, JapiImpl> {
  const top = () => rt.damageStack[rt.damageStack.length - 1];

  return {
    EXGetEventDamageData: (_ctx, args) => {
      const live = top();
      if (!live) return jInt(0);
      const blow = live.blow;
      switch (asInt(args[0] ?? JNULL)) {
        case 0: return jInt(1);
        case 1: return jInt(blow.physical ? 1 : 0);
        case 2: return jInt(blow.isAttack ? 1 : 0);
        case 3: return jInt(blow.isRanged ? 1 : 0);
        case 4: return jInt(blow.damageType);
        case 5: return jInt(blow.weaponType ?? 0);
        case 6: return jInt(Math.max(0, ATTACK_TYPES.indexOf(blow.attackType as never)));
        default: return jInt(0);
      }
    },

    EXSetEventDamage: (_ctx, args) => {
      const live = top();
      if (!live) return jBool(false);
      live.blow.amount = asNum(args[0] ?? JNULL);
      return jBool(true);
    },
  };
}
