import type { HandleMode } from "./handles";

// The handful of switches `jass.runtime` exposes (docs/lua-engine-port.md §5.4;
// yd_lua_engine/libs_runtime.cpp:8-13, 185-262).
//
// They belong to ONE Lua state, not to the engine: a second map loaded in the same page gets
// its own. The error handler is a registry ref rather than a Lua table field so a script can
// replace it and the old function is unref'd.

/** Lua's LUA_NOREF — `luaL_ref` never returns it for a live reference. */
export const LUA_NOREF = -2;

export interface LuaRuntimeSettings {
  /** Registry ref of the script's `error_handle`, or LUA_NOREF. */
  errorHandleRef: number;
  /** The level the script ASKED for (YD reports the requested value, not the effective one). */
  handleLevel: HandleMode;
  console: boolean;
  sleep: boolean;
  catchCrash: boolean;
}

export function createSettings(opts: { sleep?: boolean; handleLevel?: HandleMode }): LuaRuntimeSettings {
  return {
    errorHandleRef: LUA_NOREF,
    handleLevel: opts.handleLevel ?? 2,
    console: false,
    sleep: opts.sleep ?? true,
    catchCrash: true,
  };
}
