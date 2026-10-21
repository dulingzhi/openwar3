import { lua, lauxlib, to_jsstring, to_luastring, type LuaState } from "fengari";
import { asInt } from "../../../jass/values";
import type { LuaModuleHost } from "../host";
import { LUA_NOREF } from "../settings";

// `jass.runtime` — the engine's own switches (docs/lua-engine-port.md §5.4;
// yd_lua_engine/libs_runtime.cpp:8-13, 185-262, 317-338).
//
// Three of these change behaviour immediately (`sleep`, `handle_level`, `error_handle`); the
// rest are read back and reported (`console`, `catch_crash`). `version` is YD's 3.

export function open(host: LuaModuleHost, S: LuaState): void {
  const settings = host.settings;

  lua.lua_newtable(S);
  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    const key = raw ? to_jsstring(raw) : "";
    switch (key) {
      case "version": lua.lua_pushinteger(C, 3); return 1;
      case "error_handle":
        if (settings.errorHandleRef === LUA_NOREF) lua.lua_pushnil(C);
        else lua.lua_rawgeti(C, lua.LUA_REGISTRYINDEX, settings.errorHandleRef);
        return 1;
      case "handle_level": lua.lua_pushinteger(C, settings.handleLevel); return 1;
      case "console": lua.lua_pushboolean(C, settings.console); return 1;
      case "sleep": lua.lua_pushboolean(C, settings.sleep); return 1;
      case "can_sleep": lua.lua_pushboolean(C, settings.sleep && lua.lua_isyieldable(C)); return 1;
      case "catch_crash": lua.lua_pushboolean(C, settings.catchCrash); return 1;
      default: lua.lua_pushnil(C); return 1;
    }
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    const key = raw ? to_jsstring(raw) : "";
    switch (key) {
      case "error_handle": {
        if (settings.errorHandleRef !== LUA_NOREF) {
          lauxlib.luaL_unref(C, lua.LUA_REGISTRYINDEX, settings.errorHandleRef);
          settings.errorHandleRef = LUA_NOREF;
        }
        if (lua.lua_type(C, 3) === lua.LUA_TFUNCTION) {
          lua.lua_pushvalue(C, 3);
          settings.errorHandleRef = lauxlib.luaL_ref(C, lua.LUA_REGISTRYINDEX);
        }
        return 0;
      }
      case "handle_level": {
        const mode = asInt(host.read(C, 3));
        if (mode === 0 || mode === 1 || mode === 2) host.setHandleLevel(mode);
        return 0;
      }
      case "console": settings.console = lua.lua_toboolean(C, 3); return 0;
      case "sleep": settings.sleep = lua.lua_toboolean(C, 3); return 0;
      case "catch_crash": settings.catchCrash = lua.lua_toboolean(C, 3); return 0;
      default: return 0;
    }
  });
  lua.lua_rawset(S, -3);

  // A FIELD of the module table (not the metatable): the stack is [module, mt, key, fn].
  lua.lua_pushstring(S, to_luastring("perftrace"));
  lua.lua_pushjsfunction(S, (C) => {
    lua.lua_pushstring(C, to_luastring(host.perftrace()));
    return 1;
  });
  lua.lua_rawset(S, -4);

  lua.lua_setmetatable(S, -2);
}
