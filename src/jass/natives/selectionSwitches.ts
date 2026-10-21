import { truthy, JNULL } from "../values";
import type { NativeCtx, Runtime } from "../runtime";

// common.j's three mouse-selection switches. They were declared in 1.27's common.j but never
// implemented here, so DSIII's init logged them as "not implemented". They gate the local
// input path (`EngineHooks.setSelectEnabled`); with no engine attached they are no-ops.
export function registerSelectionSwitches(rt: Runtime): void {
  const def = (name: string): void => {
    rt.natives.set(name, (c: NativeCtx, args) => {
      c.rt.hooks?.setSelectEnabled?.(name, truthy(args[0]));
      return JNULL;
    });
  };
  def("EnableSelect");
  def("EnableDragSelect");
  def("EnablePreSelect");
}
