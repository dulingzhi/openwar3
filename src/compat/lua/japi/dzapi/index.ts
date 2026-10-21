import type { Runtime } from "../../../../jass/runtime";
import { DZAPI } from "../dzapi-decl";
import { registerJapiAlias } from "../registry";
import { valueImpls } from "./values";
import { systemImpls } from "./system";
import { textTagImpls } from "./texttag";
import { unitDbImpls } from "./unitdb";
import { effectImpls } from "./effect";
import { selectionImpls } from "./selection";
import { frameImpls } from "./frame";
import { inputImpls } from "./input";
import { hardwareImpls } from "./hardware";

// DzAPI P1 registration (docs/dzapi-port.md §4).
//
// The declarations are already in `rt.japi` / `rt.nativeReturns` (host.ts, generated table),
// so a pack only installs the IMPLEMENTATION into `rt.natives`. `jass.japi` notices the native
// and switches from its typed-default stub to the real closure automatically; `jass.common`
// and `_G` use the native directly.

export function installDzapi(rt: Runtime, interp?: unknown): void {
  // DzAPI is a NATIVE layer: register the declarations for EVERY map (JASS or Lua), then the
  // packs. `registerJapiAlias` is idempotent, so the Lua host can call this too.
  for (const decl of DZAPI) registerJapiAlias(rt, decl);
  const impls = {
    ...valueImpls(rt), ...systemImpls(rt), ...textTagImpls(rt), ...unitDbImpls(rt),
    ...effectImpls(rt), ...selectionImpls(rt), ...frameImpls(rt),
    ...inputImpls(rt, interp as never | undefined), ...hardwareImpls(rt),
  };
  for (const [name, fn] of Object.entries(impls)) rt.natives.set(name, fn);
}
