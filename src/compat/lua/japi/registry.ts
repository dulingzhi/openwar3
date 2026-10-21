import type { NativeCtx, Runtime } from "../../../jass/runtime";
import type { JassValue } from "../../../jass/values";
import type { JapiDecl } from "./decl";
import { parseSignature } from "./signature";

// `japi_add` in our terms (docs/lua-engine-port.md §6.1-6.2).
//
// The original's `japi_add` does TWO things: it registers the function in the game's JASS
// native table AND in the `japi_function` map. Ours does the same — `rt.natives` (+ the
// signature tables) and `rt.japi` — so ONE implementation serves JASS, `jass.common` and
// `jass.japi`. A declaration with no implementation still fills the signature tables, which
// is what makes a declared-but-missing name answer a typed default instead of nil.

export type JapiImpl = (ctx: NativeCtx, args: JassValue[]) => JassValue;

export function registerJapi(rt: Runtime, decl: JapiDecl, impl?: JapiImpl): void {
  if (rt.japi.has(decl.name)) return; // a second Lua host must not overwrite an implementation
  const sig = parseSignature(decl.param);
  rt.japi.set(decl.name, { params: sig.params, returns: sig.returns, impl });
  rt.nativeParams.set(decl.name, sig.params);
  rt.nativeReturns.set(decl.name, sig.returns);
  if (impl) rt.natives.set(decl.name, impl);
}
