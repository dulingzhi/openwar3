import { lua, to_luastring, type LuaState } from "fengari";
import { JNULL } from "../../../jass/values";
import type { LuaModuleHost } from "../host";
import { pushArrayProxy } from "./jarray";

// `jass.globals` — the YD module over the map's own globals (docs/lua-engine-port.md §5.3;
// yd_lua_engine/libs_globals.cpp:142-163).
//
// Scalars are LIVE: the interpreter writes them and a script reads them on the next access.
// Arrays are live proxies (jarray.ts). A write goes through `Runtime.assignGlobal`, so
// `TriggerRegisterVariableEvent` fires exactly as it does for a JASS `set`.
//
// An unknown name is ignored rather than created — the original's `jglobals_set` does the
// same. A script that wants a Lua global simply omits `G.`.

export function open(host: LuaModuleHost, S: LuaState): void {
  const rt = host.rt;

  const pushAt = (S: LuaState, key: string): boolean => {
    const g = rt.globals.get(key);
    if (g !== undefined) { host.push(S, g); return true; }
    const arr = rt.globalArrays.get(key);
    if (arr) { pushArrayProxy(host, S, arr); return true; }
    return false;
  };

  lua.lua_newtable(S);
  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (S) => {
    const raw = lua.lua_tolstring(S, 2);
    const key = raw ? lua.lua_tojsstring(S, 2) : null;
    if (key === null || !pushAt(S, key)) lua.lua_pushnil(S);
    return 1;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, (S) => {
    const raw = lua.lua_tolstring(S, 2);
    const key = raw ? lua.lua_tojsstring(S, 2) : null;
    if (key !== null && rt.globals.has(key) && !rt.globalArrays.has(key)) {
      rt.assignGlobal(key, host.read(S, 3));
    }
    return 0;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__pairs"));
  lua.lua_pushjsfunction(S, (S) => {
    const names = [...new Set([...rt.globals.keys(), ...rt.globalArrays.keys()])].sort();
    const state = { names, i: 0 };
    lua.lua_pushjsfunction(S, (C) => {
      const st = lua.lua_touserdata(C, 1) as { names: string[]; i: number };
      if (!st || st.i >= st.names.length) { lua.lua_pushnil(C); return 1; }
      const name = st.names[st.i++];
      lua.lua_pushstring(C, to_luastring(name));
      const arr = rt.globalArrays.get(name);
      if (arr) pushArrayProxy(host, C, arr);
      else host.push(C, rt.globals.get(name) ?? JNULL);
      return 2;
    });
    lua.lua_pushlightuserdata(S, state);
    lua.lua_pushnil(S);
    return 3;
  });
  lua.lua_rawset(S, -3);

  lua.lua_setmetatable(S, -2);
}
