import { lua, to_jsstring, to_luastring, type LuaState } from "fengari";

// Lua's `tostring`, from the C side (console/log/print all format their arguments this way).
//
// `lua_tolstring` only converts strings and numbers; a boolean or a table would read as
// "nil"/null. The original calls Lua's own `tostring` (`lua_getglobal(L, "tostring")`), so we
// do the same once the cheap cases are out of the way.

export function luaToString(S: LuaState, i: number): string {
  switch (lua.lua_type(S, i)) {
    case lua.LUA_TNONE:
    case lua.LUA_TNIL:
      return "nil";
    case lua.LUA_TBOOLEAN:
      return lua.lua_toboolean(S, i) ? "true" : "false";
    default: {
      const raw = lua.lua_tolstring(S, i);
      if (raw) return to_jsstring(raw);
      lua.lua_getglobal(S, to_luastring("tostring"));
      if (lua.lua_type(S, -1) !== lua.LUA_TFUNCTION) { lua.lua_pop(S, 1); return "?"; }
      lua.lua_pushvalue(S, i);
      if (lua.lua_pcall(S, 1, 1, 0) !== lua.LUA_OK) { lua.lua_pop(S, 1); return "?"; }
      const out = lua.lua_tolstring(S, -1);
      const text = out ? to_jsstring(out) : "?";
      lua.lua_pop(S, 1);
      return text;
    }
  }
}
