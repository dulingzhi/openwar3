import type { Runtime } from "../../../jass/runtime";
import { asStr, jBool, JNULL } from "../../../jass/values";
import type { JapiImpl } from "./registry";

// `EXDclareButtonIcon` / `EXBlendButtonIcon` (docs/lua-engine-port.md §6.3;
// yd_jass_api/DisableButtonBlp.cpp).
//
// `declare` records basename → path so a later blend may name either; `blend` writes A-over-B
// into a virtual 64x64 BLP. The renderer owns both the pixels and the virtual file layer
// (render/blpBlend.ts, render/assetSolver.ts), so the compat layer only passes strings.

export function iconImpls(rt: Runtime): Record<string, JapiImpl> {
  return {
    EXDclareButtonIcon: (_c, args) => {
      rt.hooks?.declareButtonIcon?.(asStr(args[0] ?? JNULL));
      return JNULL;
    },
    EXBlendButtonIcon: (_c, args) =>
      jBool(rt.hooks?.blendButtonIcon?.(
        asStr(args[0] ?? JNULL), asStr(args[1] ?? JNULL), asStr(args[2] ?? JNULL),
      ) ?? false),
  };
}
