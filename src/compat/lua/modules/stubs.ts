import { lua, to_jsstring, to_luastring, type LuaState } from "fengari";
import type { LuaModuleHost } from "../host";

// The modules this port deliberately does not implement (docs/lua-engine-port.md §5.13).
//
// `bignum` verifies RSA signatures for loading DLLs; `debugger` loads an external debugger
// DLL; `ai` is a `DebugS` debug-AI mapping. None of them has anything to attach to in a
// browser, and inventing an implementation would be a security or correctness lie. They are
// empty tables whose members answer nil with one note, so `require` succeeds (as it does in
// the original) and the first real use is what fails.
//
// `jass.storm` IS useful: it is a deprecated `io.open` shim, and its `load` is just a read
// from the map archive. `save` has no filesystem and says false.

export function openStub(host: LuaModuleHost, S: LuaState, name: string): void {
  lua.lua_newtable(S);
  lua.lua_newtable(S);
  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    const key = raw ? to_jsstring(raw) : "";
    if (key) host.warnOnce(`stub:${name}:${key}`, "not available in OpenWar3");
    lua.lua_pushnil(C);
    return 1;
  });
  lua.lua_rawset(S, -3);
  lua.lua_setmetatable(S, -2);
}

export function openStorm(host: LuaModuleHost, S: LuaState): void {
  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("load"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 1);
    const path = raw ? to_jsstring(raw) : "";
    const bytes = path ? host.options.map?.rawBytes(path) : null;
    if (!bytes) { lua.lua_pushnil(C); return 1; }
    lua.lua_pushlstring(C, bytes, bytes.length);
    return 1;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("save"));
  lua.lua_pushjsfunction(S, (C) => {
    lua.lua_pushboolean(C, false);
    return 1;
  });
  lua.lua_rawset(S, -3);
}
