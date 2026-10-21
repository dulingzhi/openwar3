import { lua, lauxlib, to_jsstring, to_luastring, type LuaState } from "fengari";
import { jHandle } from "../../../jass/values";
import type { LuaInputEvent } from "../input";
import type { LuaModuleHost } from "../host";
import { LUA_NOREF } from "../settings";

// `jass.message` (docs/lua-engine-port.md §5.11; yd_lua_engine/libs_message.cpp).
//
// The original hooks an HWND-level message filter and reads CGameUI's command card. In a
// browser the camera, the selection and the command card live in the renderer, so the compat
// layer only declares the questions and the app answers them through `LuaInputBridge`
// (src/compat/lua/input.ts). With no bridge attached every function is a safe no-op and says
// so once — a map still loads, it just cannot react to the keyboard.
//
// `hook` is an ordinary module field: assigning a function installs the filter, assigning nil
// removes it, reading it gives the function back. The event table is YD's: `{ type, code, x, y,
// ability, order }`; returning false swallows the event.

/** The keyboard names a map indexes by a hotkey letter (A-Z, 0-9) plus the common keys. */
const KEYBOARD: ReadonlyArray<[string, number]> = (() => {
  const out: Array<[string, number]> = [];
  for (let i = 0; i < 26; i++) out.push([String.fromCharCode(65 + i), 65 + i]);
  for (let i = 0; i <= 9; i++) out.push([String(i), 48 + i]);
  for (let i = 1; i <= 12; i++) out.push([`F${i}`, 111 + i]);
  out.push(
    ["SPACE", 32], ["ENTER", 13], ["ESC", 27], ["TAB", 9], ["BACK", 8],
    ["SHIFT", 16], ["CTRL", 17], ["ALT", 18],
    ["LEFT", 37], ["UP", 38], ["RIGHT", 39], ["DOWN", 40],
    ["INSERT", 45], ["DELETE", 46], ["HOME", 36], ["END", 35], ["PGUP", 33], ["PGDN", 34],
  );
  return out;
})();

export function open(host: LuaModuleHost, S: LuaState): void {
  const bridge = host.options.input;
  let hookRef = LUA_NOREF;

  const noBridge = (what: string): void =>
    host.warnOnce(`message:${what}`, "no input bridge is attached");

  const emit = (ev: LuaInputEvent): boolean => {
    if (hookRef === LUA_NOREF) return true;
    const top = lua.lua_gettop(host.L);
    lua.lua_rawgeti(host.L, lua.LUA_REGISTRYINDEX, hookRef);
    if (lua.lua_type(host.L, -1) !== lua.LUA_TFUNCTION) { lua.lua_settop(host.L, top); return true; }
    lua.lua_createtable(host.L, 0, 0);
    const field = (k: string, push: () => void): void => {
      lua.lua_pushstring(host.L, to_luastring(k));
      push();
      lua.lua_rawset(host.L, -3);
    };
    field("type", () => lua.lua_pushstring(host.L, to_luastring(ev.type)));
    if (ev.code !== undefined) field("code", () => lua.lua_pushinteger(host.L, ev.code!));
    if (ev.x !== undefined) field("x", () => lua.lua_pushnumber(host.L, ev.x!));
    if (ev.y !== undefined) field("y", () => lua.lua_pushnumber(host.L, ev.y!));
    if (ev.ability !== undefined) field("ability", () => lua.lua_pushinteger(host.L, ev.ability!));
    if (ev.order !== undefined) field("order", () => lua.lua_pushinteger(host.L, ev.order!));
    if (lua.lua_pcall(host.L, 1, 1, 0) !== lua.LUA_OK) {
      const msg = lua.lua_gettop(host.L) ? to_jsstring(lua.lua_tolstring(host.L, -1)) : "?";
      host.reportError(`jass.message hook: ${msg}`);
      lua.lua_settop(host.L, top);
      return true;
    }
    const swallow = lua.lua_gettop(host.L) > top ? !lua.lua_toboolean(host.L, -1) : false;
    lua.lua_settop(host.L, top);
    return !swallow;
  };

  host.onDispose(() => {
    if (hookRef !== LUA_NOREF) {
      lauxlib.luaL_unref(S, lua.LUA_REGISTRYINDEX, hookRef);
      hookRef = LUA_NOREF;
    }
    bridge?.setFilter(null);
  });

  lua.lua_newtable(S);

  const setField = (name: string, fn: (C: LuaState) => number): void => {
    lua.lua_pushstring(S, to_luastring(name));
    lua.lua_pushjsfunction(S, fn);
    lua.lua_rawset(S, -3);
  };

  // keyboard: names → VK codes, the table the smart-cast demo indexes by a hotkey letter.
  lua.lua_pushstring(S, to_luastring("keyboard"));
  lua.lua_newtable(S);
  for (const [name, code] of KEYBOARD) {
    lua.lua_pushstring(S, to_luastring(name));
    lua.lua_pushinteger(S, code);
    lua.lua_rawset(S, -3);
  }
  lua.lua_rawset(S, -3);

  setField("mouse", (C) => {
    if (!bridge) { noBridge("mouse"); lua.lua_pushnumber(C, 0); lua.lua_pushnumber(C, 0); return 2; }
    const p = bridge.mouseWorld();
    lua.lua_pushnumber(C, p.x);
    lua.lua_pushnumber(C, p.y);
    return 2;
  });

  setField("button", (C) => {
    if (!bridge) { noBridge("button"); return 0; }
    const x = lua.lua_tointeger(C, 1), y = lua.lua_tointeger(C, 2);
    const b = bridge.commandButton(x, y);
    if (!b) return 0;
    lua.lua_pushinteger(C, b.ability);
    lua.lua_pushinteger(C, b.order);
    lua.lua_pushinteger(C, b.targetType);
    return 3;
  });

  setField("selection", (C) => {
    if (!bridge) { noBridge("selection"); lua.lua_pushnil(C); return 1; }
    const id = bridge.selectedUnit();
    if (id > 0) host.push(C, jHandle(id, "unit"));
    else lua.lua_pushnil(C);
    return 1;
  });

  setField("order_immediate", (C) => {
    const ok = bridge?.issueOrder("immediate", lua.lua_tointeger(C, 1), undefined, undefined, undefined, lua.lua_tointeger(C, 2)) ?? false;
    lua.lua_pushboolean(C, ok);
    return 1;
  });
  setField("order_point", (C) => {
    const ok = bridge?.issueOrder(
      "point", lua.lua_tointeger(C, 1), lua.lua_tonumber(C, 2), lua.lua_tonumber(C, 3), undefined, lua.lua_tointeger(C, 4),
    ) ?? false;
    lua.lua_pushboolean(C, ok);
    return 1;
  });
  setField("order_target", (C) => {
    const target = host.read(C, 4);
    const ok = bridge?.issueOrder(
      "target", lua.lua_tointeger(C, 1), lua.lua_tonumber(C, 2), lua.lua_tonumber(C, 3),
      target.k === "handle" ? target.h : undefined, lua.lua_tointeger(C, 5),
    ) ?? false;
    lua.lua_pushboolean(C, ok);
    return 1;
  });
  // YD's debug switch prints every locally issued order. There is no such log here; the call
  // exists so a map's startup does not fail, and says why once.
  setField("order_enable_debug", () => {
    host.warnOnce("message:order_enable_debug", "order debug output is not wired");
    return 0;
  });

  // `hook` is a FIELD, not a metatable entry: `__index`/`__newindex` below give it the
  // function-or-nil behaviour while keeping the other fields raw.
  lua.lua_newtable(S);
  lua.lua_pushstring(S, to_luastring("__index"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    if (raw && to_jsstring(raw) === "hook") {
      if (hookRef === LUA_NOREF) lua.lua_pushnil(C);
      else lua.lua_rawgeti(C, lua.LUA_REGISTRYINDEX, hookRef);
      return 1;
    }
    lua.lua_pushnil(C);
    return 1;
  });
  lua.lua_rawset(S, -3);
  lua.lua_pushstring(S, to_luastring("__newindex"));
  lua.lua_pushjsfunction(S, (C) => {
    const raw = lua.lua_tolstring(C, 2);
    if (!raw || to_jsstring(raw) !== "hook") return 0;
    if (hookRef !== LUA_NOREF) {
      lauxlib.luaL_unref(C, lua.LUA_REGISTRYINDEX, hookRef);
      hookRef = LUA_NOREF;
    }
    if (lua.lua_type(C, 3) === lua.LUA_TFUNCTION) {
      lua.lua_pushvalue(C, 3);
      hookRef = lauxlib.luaL_ref(C, lua.LUA_REGISTRYINDEX);
      bridge?.setFilter(emit);
    } else {
      bridge?.setFilter(null);
    }
    return 0;
  });
  lua.lua_rawset(S, -3);
  lua.lua_setmetatable(S, -2);
}
