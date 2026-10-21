import { lua, to_jsstring, to_luastring, type LuaState } from "fengari";
import type { LuaModuleHost } from "../host";
import { luaToString } from "../tostring";

// `jass.log` (docs/lua-engine-port.md §5.12; yd_lua_engine/libs_log.cpp).
//
// The original appends to `log-YYYY-MM-DD-HH-MM-SS.log` beside the game. There is no
// filesystem here, so `path` is accepted and remembered, and every line goes to the host's
// log sink with the same shape. The `level` switch is the useful half and works as it does
// there: a line below the threshold is dropped.
//
// Not reproduced: the original's `level` getter has a bug (`lua_tointeger(L, 1)` reads the
// module table, not the stored level). We answer the value the script set.

const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
type Level = typeof LEVELS[number];

export function open(host: LuaModuleHost, S: LuaState): void {
  const sink = host.options.log ?? ((_l: string, t: string) => console.info(t));
  let path = "";
  let level: Level = "info";

  const rank = (l: Level): number => LEVELS.indexOf(l);
  const stamp = (): string => {
    const d = new Date();
    const p = (n: number, w = 2): string => String(n).padStart(w, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  };

  lua.lua_newtable(S);

  const emit = (l: Level, C: LuaState): number => {
    const parts: string[] = [];
    for (let i = 1, n = lua.lua_gettop(C); i <= n; i++) parts.push(luaToString(C, i));
    const line = `${stamp()} [${l}]: ${parts.join("\t")}`;
    if (rank(l) >= rank(level)) sink(l, line);
    lua.lua_pushstring(C, to_luastring(line));
    return 1;
  };

  for (const l of LEVELS) {
    lua.lua_pushstring(S, to_luastring(l));
    lua.lua_pushjsfunction(S, (C) => emit(l, C));
    lua.lua_rawset(S, -3);
  }

  lua.lua_newtable(S);
  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    const key = raw ? to_jsstring(raw) : "";
    if (key === "path") { lua.lua_pushstring(C, to_luastring(path)); return 1; }
    if (key === "level") { lua.lua_pushstring(C, to_luastring(level)); return 1; }
    lua.lua_pushnil(C);
    return 1;
  });
  lua.lua_rawset(S, -3);
  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    const key = raw ? to_jsstring(raw) : "";
    if (key === "path") {
      const v = lua.lua_tolstring(C, 3);
      path = v ? to_jsstring(v) : "";
    } else if (key === "level") {
      const v = lua.lua_tolstring(C, 3);
      const name = v ? to_jsstring(v) : "";
      if ((LEVELS as readonly string[]).includes(name)) level = name as Level;
    }
    return 0;
  });
  lua.lua_rawset(S, -3);
  lua.lua_setmetatable(S, -2);
}
