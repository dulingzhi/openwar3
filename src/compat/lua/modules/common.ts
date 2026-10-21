import { lua, lauxlib, to_jsstring, to_luastring, type LuaState } from "fengari";
import type { LuaModuleHost } from "../host";
import { pushArrayProxy } from "./jarray";

// `jass.common` — the YD module a Lua script means when it writes `CJ.CreateUnit(...)`
// (docs/lua-engine-port.md §5.2; yd_lua_engine/libs_common.cpp:18-142).
//
// It is a WINDOW, not a copy: `__index` reads the running runtime on every access, because a
// JASS global is rewritten constantly (`bj_lastCreatedUnit` on nearly every BJ call) and a
// cached value would be a lie the second time a script looked. What IS cached is the closure
// for a native — a function identity, not a value — and it is cached as a registry ref rather
// than as a field of the module table, so a later `CJ.Foo = value` still reaches `__newindex`.
//
// Order matters and is YD's: a JASS global first (constants and `udg_*`), then a native (or a
// native declared in common.j that we have not implemented, which answers its typed default
// through the interpreter), then nil.

export function open(host: LuaModuleHost, S: LuaState): void {
  const rt = host.rt;
  const closures = new Map<string, number>();

  const pushCached = (S: LuaState, name: string): void => {
    let ref = closures.get(name);
    if (ref === undefined) {
      host.pushEngineClosure(S, name);
      ref = lauxlib.luaL_ref(S, lua.LUA_REGISTRYINDEX);
      closures.set(name, ref);
    }
    lua.lua_rawgeti(S, lua.LUA_REGISTRYINDEX, ref);
  };

  const keyAt = (S: LuaState, i: number): string | null => {
    const raw = lua.lua_tolstring(S, i);
    return raw ? to_jsstring(raw) : null;
  };

  lua.lua_newtable(S);
  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (S) => {
    const key = keyAt(S, 2);
    if (key === null) { lua.lua_pushnil(S); return 1; }

    // 1. a JASS global, LIVE. `undefined` is the only miss; a JASS null is a real value.
    const g = rt.globals.get(key);
    if (g !== undefined) { host.push(S, g); return 1; }
    const arr = rt.globalArrays.get(key);
    if (arr) { pushArrayProxy(host, S, arr); return 1; }

    // 2. an engine callable. A name declared in common.j but not implemented is still a
    //    callable: the interpreter answers its typed default and logs once, exactly as it does
    //    for a JASS map. A JAPI name lands here too, because japi_add registers both tables.
    if (rt.natives.has(key) || rt.nativeReturns.has(key)) { pushCached(S, key); return 1; }

    lua.lua_pushnil(S);
    return 1;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, (S) => {
    const key = keyAt(S, 2);
    // Write THROUGH to an existing scalar global, so Lua and blizzard.j never hold two copies
    // of one variable. An unknown name is ignored rather than created: a YD script that wants
    // a new Lua global omits `CJ.` and gets an ordinary one.
    if (key !== null && rt.globals.has(key) && !rt.globalArrays.has(key)) {
      rt.assignGlobal(key, host.read(S, 3));
    }
    return 0;
  });
  lua.lua_rawset(S, -3);

  // `__pairs` (Lua 5.2+) — names sorted, so a script that acts on the order sees the same
  // order on every client.
  lua.lua_pushstring(S, to_luastring("__pairs"));
  lua.lua_pushjsfunction(S, (S) => {
    const names = [...new Set([...rt.natives.keys(), ...rt.nativeReturns.keys()])].sort();
    const state = { names, i: 0 };
    lua.lua_pushjsfunction(S, (C) => {
      const st = lua.lua_touserdata(C, 1) as { names: string[]; i: number };
      if (!st || st.i >= st.names.length) { lua.lua_pushnil(C); return 1; }
      const name = st.names[st.i++];
      lua.lua_pushstring(C, to_luastring(name));
      pushCached(C, name);
      return 2;
    });
    lua.lua_pushlightuserdata(S, state);
    lua.lua_pushnil(S);
    return 3;
  });
  lua.lua_rawset(S, -3);

  lua.lua_setmetatable(S, -2);
}
