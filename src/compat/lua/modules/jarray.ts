import { lua, to_luastring, type LuaState } from "fengari";
import type { JassArray } from "../../../jass/runtime";
import type { JassValue } from "../../../jass/values";

// A live view of a JASS array (docs/lua-engine-port.md §5.3).
//
// This must be a VIEW, never a copy. A trigger, a hashtable or the interpreter writes the same
// `JassArray` object while Lua holds the proxy, and the next read has to see that write.
//
// JASS arrays are fixed at 8192 slots (`JassArray` in jass/runtime.ts), indexed from 0, and an
// unwritten slot reads the element type's default. The original's `jarray_index` does the same
// (yd_lua_engine/class_array.cpp:24-58): out-of-range reads answer nil and writes are ignored.
//
// The backing object is stored under a unique LIGHT-USERDATA key, not a string field, so a
// script cannot reach in and replace it with something else.

const ARRAY_KEY = {};

export interface ArrayProxyHost {
  push(S: LuaState, v: JassValue): void;
  read(S: LuaState, i: number): JassValue;
}

export function pushArrayProxy(host: ArrayProxyHost, S: LuaState, arr: JassArray): void {
  lua.lua_createtable(S, 0, 1);

  lua.lua_pushlightuserdata(S, ARRAY_KEY);
  lua.lua_pushlightuserdata(S, arr);
  lua.lua_rawset(S, -3);

  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (C) => {
    const a = arrayOf(C);
    const i = indexOf(C, 2);
    if (!a || i < 0) { lua.lua_pushnil(C); return 1; }
    host.push(C, a.get(i));
    return 1;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, (C) => {
    const a = arrayOf(C);
    const i = indexOf(C, 2);
    if (a && i >= 0) a.set(i, host.read(C, 3));
    return 0;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__len"));
  lua.lua_pushjsfunction(S, (C) => {
    lua.lua_pushinteger(C, 8192);
    return 1;
  });
  lua.lua_rawset(S, -3);

  lua.lua_setmetatable(S, -2);
}

function arrayOf(S: LuaState): JassArray | null {
  lua.lua_pushlightuserdata(S, ARRAY_KEY);
  lua.lua_rawget(S, 1);
  const a = lua.lua_touserdata(S, -1) as JassArray | null;
  lua.lua_pop(S, 1);
  return a && typeof (a as { get?: unknown }).get === "function" ? a : null;
}

/** A valid 0-based JASS index, or -1. */
function indexOf(S: LuaState, at: number): number {
  if (lua.lua_type(S, at) !== lua.LUA_TNUMBER) return -1;
  const i = lua.lua_tointeger(S, at);
  return i >= 0 && i < 8192 ? i : -1;
}
