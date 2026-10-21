import type { Runtime } from "../../../jass/runtime";
import { intToRawcode } from "../../../jass/lexer";
import { asInt, asStr, jBool, jStr, JNULL } from "../../../jass/values";
import type { JapiImpl } from "./registry";

// `EXGetItemDataString` / `EXSetItemDataString` (docs/lua-engine-port.md §6.3;
// yd_jass_api/ItemState.cpp:150-188).
//
// The three ids are the ones YDWE's own header documents (YDWEState.j): 1 = Art,
// 3 = Ubertip, 4 = Name. The answer comes from the renderer's own ItemRegistry through an
// EngineHooks seam, so a map's custom .w3t row is what it reads.
//
// Writes are refused: the registry row is shared by every match in the page, and a per-type
// override layer does not exist yet. `false` is the honest answer (YD returns false when it
// cannot write too).

export function itemImpls(rt: Runtime): Record<string, JapiImpl> {
  return {
    EXGetItemDataString: (_c, args) => {
      const typeId = intToRawcode(asInt(args[0] ?? JNULL));
      const id = asInt(args[1] ?? JNULL);
      const v = rt.hooks?.itemTypeString?.(typeId, id);
      if (v === undefined) {
        rt.warnOnce(`japi:EXGetItemDataString:${id}`, "no item string for that id — empty");
        return jStr("");
      }
      return jStr(v);
    },
    EXSetItemDataString: (_c, args) => {
      const typeId = intToRawcode(asInt(args[0] ?? JNULL));
      const id = asInt(args[1] ?? JNULL);
      const value = asStr(args[2] ?? JNULL);
      return jBool(rt.hooks?.setItemTypeString?.(typeId, id, value) ?? false);
    },
  };
}
