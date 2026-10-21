import { lua, lauxlib, to_jsstring, to_luastring, type LuaState } from "fengari";
import { defaultForType } from "../../../jass/values";
import type { LuaModuleHost } from "../host";

// `jass.japi` — a window over the JAPI registry (docs/lua-engine-port.md §5.6, §6).
//
// Three states, and the middle one is the point of the whole design:
//   * registered + implemented → the same closure `jass.common` would hand out;
//   * registered + NOT implemented → a callable that logs once and answers its declared
//     type's default, so a YDWE map keeps running and the log names what is missing;
//   * unknown → nil, so a typo fails where it is written.

export function open(host: LuaModuleHost, S: LuaState): void {
  const { rt } = host;
  const closures = new Map<string, number>();
  const stubs = new Map<string, number>();

  const pushCached = (C: LuaState, name: string): void => {
    let ref = closures.get(name);
    if (ref === undefined) {
      host.pushEngineClosure(C, name);
      ref = lauxlib.luaL_ref(C, lua.LUA_REGISTRYINDEX);
      closures.set(name, ref);
    }
    lua.lua_rawgeti(C, lua.LUA_REGISTRYINDEX, ref);
  };

  const pushStub = (C: LuaState, name: string, returns: string): void => {
    let ref = stubs.get(name);
    if (ref === undefined) {
      const fn = (T: LuaState): number => {
        host.warnOnce(`japi:${name}`, "JAPI function is declared but not implemented — typed default");
        host.push(T, defaultForType(returns));
        return 1;
      };
      // A stub is still a nameable engine function: `jass.debug.functiondef` answers its
      // DECLARED signature, as it does for the original's `japi_func` entries.
      host.tagEngineFunction(fn, name);
      lua.lua_pushjsfunction(C, fn);
      ref = lauxlib.luaL_ref(C, lua.LUA_REGISTRYINDEX);
      stubs.set(name, ref);
    }
    lua.lua_rawgeti(C, lua.LUA_REGISTRYINDEX, ref);
  };

  const pushFor = (C: LuaState, name: string): boolean => {
    const entry = rt.japi.get(name);
    if (!entry) return false;
    if (entry.impl && rt.natives.has(name)) pushCached(C, name);
    else pushStub(C, name, entry.returns);
    return true;
  };

  lua.lua_newtable(S);
  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    const name = raw ? to_jsstring(raw) : "";
    if (!pushFor(C, name)) lua.lua_pushnil(C);
    return 1;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, () => 0);
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__pairs"));
  lua.lua_pushjsfunction(S, (C) => {
    const names = [...rt.japi.keys()].sort();
    const state = { names, i: 0 };
    lua.lua_pushjsfunction(C, (T) => {
      const st = lua.lua_touserdata(T, 1) as { names: string[]; i: number };
      if (!st || st.i >= st.names.length) { lua.lua_pushnil(T); return 1; }
      const name = st.names[st.i++];
      lua.lua_pushstring(T, to_luastring(name));
      pushFor(T, name);
      return 2;
    });
    lua.lua_pushlightuserdata(C, state);
    lua.lua_pushnil(C);
    return 3;
  });
  lua.lua_rawset(S, -3);

  lua.lua_setmetatable(S, -2);
}
