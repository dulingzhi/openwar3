import { lua, to_jsstring, to_luastring, type LuaState } from "fengari";
import { asInt, jHandle } from "../../../jass/values";
import type { LuaModuleHost } from "../host";

// `jass.debug` — introspection over the live runtime (docs/lua-engine-port.md §5.7;
// yd_lua_engine/libs_debug.cpp:8-180).
//
// The original reads the JASS VM's own tables. We answer the same questions from the maps it
// answers from: `nativeParams` / `nativeReturns` / `functions` for signatures, `globalTypes` /
// `globalArrays` for globals, and the handle table for ids.
//
// `functiondef` only knows ENGINE closures. A map's own Lua function handed back to the script
// has no JASS declaration, and YD answers nil for exactly the same reason (it reads the
// `func_value` pointer stored in the closure's first upvalue; a Lua function has none).
//
// The type characters are `variable_type`'s own letters (ydbase func_value.h:13-24):
// I integer, R real, B boolean, S string, C code, H handle, V nothing.

const charOf = (type: string): string => {
  switch (type) {
    case "integer": return "I";
    case "real": return "R";
    case "boolean": return "B";
    case "string": return "S";
    case "code": return "C";
    case "nothing": return "V";
    default: return "H"; // every other declared type is a handle-derived one
  }
};

export function open(host: LuaModuleHost, S: LuaState): void {
  const { rt } = host;

  const signatureOf = (name: string): { params: string[]; returns: string } | null => {
    const fn = rt.functions.get(name);
    const params = rt.nativeParams.get(name) ?? fn?.params.map((p) => p.type);
    const returns = rt.nativeReturns.get(name) ?? fn?.returns;
    return params && returns !== undefined ? { params, returns } : null;
  };

  const pushString = (C: LuaState, s: string): void => lua.lua_pushstring(C, to_luastring(s));

  lua.lua_newtable(S);

  const set = (name: string, fn: (C: LuaState) => number): void => {
    pushString(S, name);
    lua.lua_pushjsfunction(S, fn);
    lua.lua_rawset(S, -3);
  };

  set("functiondef", (C) => {
    const name = host.nameOfEngineFunction(C, 1);
    const sig = name ? signatureOf(name) : null;
    if (!sig) { lua.lua_pushnil(C); return 1; }
    lua.lua_createtable(C, 1 + sig.params.length, 0);
    pushString(C, charOf(sig.returns));
    lua.lua_rawseti(C, -2, 1);
    for (let i = 0; i < sig.params.length; i++) {
      pushString(C, charOf(sig.params[i]));
      lua.lua_rawseti(C, -2, i + 2);
    }
    return 1;
  });

  set("globaldef", (C) => {
    const name = lua.lua_tolstring(C, 1) ? to_jsstring(lua.lua_tolstring(C, 1)) : "";
    const scalar = rt.globalTypes.get(name);
    if (scalar) { pushString(C, charOf(scalar)); return 1; }
    const arr = rt.globalArrays.get(name);
    if (arr) { pushString(C, `${charOf(arr.elemType)}[]`); return 1; }
    lua.lua_pushnil(C);
    return 1;
  });

  set("handledef", (C) => {
    const v = host.read(C, 1);
    if (v.k !== "handle" || v.h <= 0) { lua.lua_pushnil(C); return 1; }
    lua.lua_newtable(C);
    pushString(C, "reference"); lua.lua_pushinteger(C, 1); lua.lua_rawset(C, -3);
    pushString(C, "type"); pushString(C, v.ty); lua.lua_rawset(C, -3);
    return 1;
  });

  set("h2i", (C) => {
    const v = host.read(C, 1);
    lua.lua_pushinteger(C, v.k === "handle" ? v.h : 0);
    return 1;
  });

  set("i2h", (C) => {
    host.push(C, jHandle(asInt(host.read(C, 1)), "handle"));
    return 1;
  });

  // YD's ref/unref call the engine and then `return 1` without pushing, so the argument is
  // what comes back. There is no refcount to change here (the JS handle table owns lifetime).
  set("handle_ref", () => 1);
  set("handle_unref", () => 1);
  set("handlemax", (C) => { lua.lua_pushinteger(C, rt.handles.maxId()); return 1; });
  set("handlecount", (C) => { lua.lua_pushinteger(C, rt.handles.liveCount()); return 1; });
  set("gchash", () => 0);
  set("currentpos", (C) => { lua.lua_pushnil(C); lua.lua_pushinteger(C, 0); return 2; });
}
