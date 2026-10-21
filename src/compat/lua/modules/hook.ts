import { lua, lauxlib, to_jsstring, to_luastring, type LuaState } from "fengari";
import type { NativeCtx } from "../../../jass/runtime";
import { defaultForType, type JassValue } from "../../../jass/values";
import type { LuaModuleHost } from "../host";
import { LUA_NOREF } from "../settings";

// `jass.hook` — replace a native from Lua (docs/lua-engine-port.md §5.5;
// yd_lua_engine/libs_hook.cpp:135-304).
//
// The callback signature is YD's: the native's arguments, then a trailing `real` closure that
// calls the original. Our natives are untyped JavaScript functions taking a `NativeCtx` and a
// `JassValue[]`, so the wrapper captures the ctx of the CURRENT call and hands `real` that same
// ctx — nested calls cannot cross wires.
//
// A hook callback runs synchronously: a native's return cannot suspend, so a wait inside one is
// refused with the error handler rather than silently ignored.
//
// Installing twice replaces the callback and keeps the ORIGINAL once. Restoring is by identity:
// the entry remembers the native it replaced, so a JAPI/other hook installed around ours is not
// silently removed by `= nil`.

type NativeFn = (ctx: NativeCtx, args: JassValue[]) => JassValue;

interface HookEntry {
  /** The native this hook wrapped; undefined when the name was only DECLARED. */
  original: NativeFn | undefined;
  callbackRef: number;
}

export function open(host: LuaModuleHost, S: LuaState): void {
  const { rt } = host;
  const hooks = new Map<string, HookEntry>();

  const restore = (name: string, entry: HookEntry): void => {
    if (entry.original) rt.natives.set(name, entry.original);
    else rt.natives.delete(name);
    if (entry.callbackRef !== LUA_NOREF) lauxlib.luaL_unref(S, lua.LUA_REGISTRYINDEX, entry.callbackRef);
  };

  host.onDispose(() => {
    for (const [name, entry] of hooks) restore(name, entry);
    hooks.clear();
  });

  const keyAt = (C: LuaState, i: number): string | null => {
    const raw = lua.lua_tolstring(C, i);
    return raw ? to_jsstring(raw) : null;
  };

  lua.lua_newtable(S);
  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (C) => {
    const name = keyAt(C, 2);
    const entry = name ? hooks.get(name) : undefined;
    if (!entry) { lua.lua_pushnil(C); return 1; }
    lua.lua_rawgeti(C, lua.LUA_REGISTRYINDEX, entry.callbackRef);
    return 1;
  });
  lua.lua_rawset(S, -3);

  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, (C) => {
    const name = keyAt(C, 2);
    if (name === null || (!rt.natives.has(name) && !rt.nativeReturns.has(name))) return 0;

    if (lua.lua_type(C, 3) === lua.LUA_TFUNCTION) {
      let entry = hooks.get(name);
      if (!entry) {
        entry = { original: rt.natives.get(name), callbackRef: LUA_NOREF };
        hooks.set(name, entry);
      }
      if (entry.callbackRef !== LUA_NOREF) lauxlib.luaL_unref(C, lua.LUA_REGISTRYINDEX, entry.callbackRef);
      lua.lua_pushvalue(C, 3);
      entry.callbackRef = lauxlib.luaL_ref(C, lua.LUA_REGISTRYINDEX);

      const captured = entry;
      const fallback = defaultForType(rt.nativeReturns.get(name) ?? "nothing");
      rt.natives.set(name, (ctx, args) =>
        host.callLuaRef(captured.callbackRef, args, (realArgs) =>
          captured.original ? captured.original(ctx, realArgs) : fallback,
        ),
      );
    } else if (lua.lua_type(C, 3) === lua.LUA_TNIL) {
      const entry = hooks.get(name);
      if (entry) {
        restore(name, entry);
        hooks.delete(name);
      }
    }
    return 0;
  });
  lua.lua_rawset(S, -3);

  lua.lua_setmetatable(S, -2);
}
