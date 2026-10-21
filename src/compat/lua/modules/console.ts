import { lua, to_jsstring, to_luastring, type LuaState } from "fengari";
import type { LuaModuleHost } from "../host";
import { luaToString } from "../tostring";

// `jass.console` (docs/lua-engine-port.md §5.12; yd_lua_engine/libs_console.cpp).
//
// The original opens a Win32 console window. A browser has no stdin and already has a console,
// so `enable` is a stored switch and `write` goes to the host's log sink. `read(fn)` exists (a
// map may call it) and never fires — there is nothing to read from.

export function open(host: LuaModuleHost, S: LuaState): void {
  const sink = (text: string): void => (host.options.log ?? ((_l, t) => console.info(t)))("info", text);

  lua.lua_newtable(S);
  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    if (raw && to_jsstring(raw) === "enable") { lua.lua_pushboolean(C, host.settings.console); return 1; }
    lua.lua_pushnil(C);
    return 1;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    if (raw && to_jsstring(raw) === "enable") host.settings.console = lua.lua_toboolean(C, 3);
    return 0;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("write"));
  lua.lua_pushjsfunction(S, (C) => {
    const parts: string[] = [];
    for (let i = 1, n = lua.lua_gettop(C); i <= n; i++) parts.push(luaToString(C, i));
    sink(parts.join("\t"));
    return 0;
  });
  lua.lua_rawset(S, -4);

  lua.lua_pushstring(S, to_luastring("read"));
  lua.lua_pushjsfunction(S, () => 0);
  lua.lua_rawset(S, -4);

  lua.lua_setmetatable(S, -2);
}
