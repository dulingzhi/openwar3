import type { Runtime } from "../../../jass/runtime";
import { intToRawcode } from "../../../jass/lexer";
import { asInt, asStr, jBool, jStr, JNULL } from "../../../jass/values";
import type { JapiImpl } from "./registry";

// `EXGetBuffDataString` / `EXSetBuffDataString` (docs/lua-engine-port.md §6.3;
// yd_jass_api/AbilityState.cpp:775-931).
//
// Type ids from YDWEState.j: 1 Art, 2 Tip, 3 Ubertip. The answer is the buff row's own
// `Buffart`, `Bufftip` and `Buffubertip` (AbilityRegistry.buff); a write clones that one row
// in the per-map registry, so the status icon/tooltip follows without touching the stock table.

export function buffImpls(rt: Runtime): Record<string, JapiImpl> {
  return {
    EXGetBuffDataString: (_c, args) => {
      const code = intToRawcode(asInt(args[0] ?? JNULL));
      const id = asInt(args[1] ?? JNULL);
      const v = rt.hooks?.buffString?.(code, id);
      if (v === undefined) rt.warnOnce(`japi:EXGetBuffDataString:${id}`, "no such buff string — empty");
      return jStr(v ?? "");
    },
    EXSetBuffDataString: (_c, args) => {
      const code = intToRawcode(asInt(args[0] ?? JNULL));
      const id = asInt(args[1] ?? JNULL);
      return jBool(rt.hooks?.setBuffString?.(code, id, asStr(args[2] ?? JNULL)) ?? false);
    },
  };
}
