import { lua, lauxlib, to_jsstring, to_luastring, type LuaState } from "fengari";
import type { LuaModuleHost } from "../host";

// `jass.code` — script functions as values, and hooks over them (docs/lua-engine-port.md §5.9;
// yd_lua_engine/libs_code.cpp).
//
// `codes[name]` answers a callable that invokes the script function by name. Assigning a
// function installs a hook in `Runtime.codeHooks`, which the interpreter consults AFTER natives
// and host functions and BEFORE the JASS declaration — so the hook wraps the script's own body,
// and its trailing `real` closure runs that body.
//
// Only a name the runtime actually has is hookable; a typo is ignored rather than creating a
// function that never runs.

export function open(host: LuaModuleHost, S: LuaState): void {
  const { rt } = host;
  const closures = new Map<string, number>();
  const hooked = new Map<string, number>();

  host.onDispose(() => {
    for (const [name, ref] of hooked) {
      rt.codeHooks.delete(name);
      lauxlib.luaL_unref(S, lua.LUA_REGISTRYINDEX, ref);
    }
    hooked.clear();
  });

  const exists = (name: string): boolean => rt.functions.has(name) || rt.hostFunctions.has(name);

  const pushCached = (C: LuaState, name: string): void => {
    let ref = closures.get(name);
    if (ref === undefined) {
      host.pushEngineClosure(C, name);
      ref = lauxlib.luaL_ref(C, lua.LUA_REGISTRYINDEX);
      closures.set(name, ref);
    }
    lua.lua_rawgeti(C, lua.LUA_REGISTRYINDEX, ref);
  };

  lua.lua_newtable(S);
  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    const name = raw ? to_jsstring(raw) : "";
    if (exists(name)) pushCached(C, name);
    else lua.lua_pushnil(C);
    return 1;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    const name = raw ? to_jsstring(raw) : "";
    if (!name || !exists(name)) return 0;

    const previous = hooked.get(name);
    if (previous !== undefined) {
      lauxlib.luaL_unref(C, lua.LUA_REGISTRYINDEX, previous);
      hooked.delete(name);
      rt.codeHooks.delete(name);
    }
    if (lua.lua_type(C, 3) === lua.LUA_TFUNCTION) {
      lua.lua_pushvalue(C, 3);
      const ref = lauxlib.luaL_ref(C, lua.LUA_REGISTRYINDEX);
      hooked.set(name, ref);
      rt.codeHooks.set(name, (_ctx, args, real) => host.callLuaRef(ref, args, real));
    }
    return 0;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__pairs"));
  lua.lua_pushjsfunction(S, (C) => {
    const names = [...new Set([...rt.functions.keys(), ...rt.hostFunctions.keys()])].sort();
    const state = { names, i: 0 };
    lua.lua_pushjsfunction(C, (T) => {
      const st = lua.lua_touserdata(T, 1) as { names: string[]; i: number };
      if (!st || st.i >= st.names.length) { lua.lua_pushnil(T); return 1; }
      const name = st.names[st.i++];
      lua.lua_pushstring(T, to_luastring(name));
      pushCached(T, name);
      return 2;
    });
    lua.lua_pushlightuserdata(C, state);
    lua.lua_pushnil(C);
    return 3;
  });
  lua.lua_rawset(S, -3);

  lua.lua_setmetatable(S, -2);
}
