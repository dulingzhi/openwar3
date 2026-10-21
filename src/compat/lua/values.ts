import { lua, to_jsstring, to_luastring, type LuaState } from "fengari";
import { jBool, jInt, jReal, jStr, JNULL, type JassValue } from "../../jass/values";
import type { HandleCodec } from "./handles";

// The Lua ↔ JASS value bridge, one place (docs/lua-engine-port.md §4).
//
// The conversions are YD's (`yd_lua_engine/jassbind.cpp`), not JS's:
//
//   * int and real stay separate — Lua 5.3 has both, and JASS arithmetic depends on the
//     distinction (`7/2` is 3, `7/2.0` is 3.5);
//   * a handle is whatever the codec says (integer / light userdata / userdata), and a null
//     handle is nil;
//   * a `code` becomes a callable closure, and a Lua function read back becomes a host
//     function — the same round trip YD makes through `cfunction_to_code`;
//   * nil is JASS null, and a table (which has no JASS equivalent) is null with a note at the
//     call site rather than an invented value.

export interface ValueBridge {
  handles: HandleCodec;
  /** Register a Lua function as an engine host function; returns the name it is known by. */
  functionName(L: LuaState, i: number): string;
  /** Push the callable for an engine/host function name. Never throws for a missing name. */
  pushNamedFunction(L: LuaState, name: string): void;
  /** The host name of an engine closure at `i`, or null (a map Lua function answers null). */
  nameOfEngineFunction(L: LuaState, i: number): string | null;
}

/** Push a JASS value onto `L`. */
export function pushValue(L: LuaState, v: JassValue, b: ValueBridge): void {
  switch (v.k) {
    case "int": lua.lua_pushinteger(L, v.n); return;
    case "real": lua.lua_pushnumber(L, v.n); return;
    case "bool": lua.lua_pushboolean(L, v.b); return;
    case "string": lua.lua_pushstring(L, to_luastring(v.s)); return;
    case "handle": b.handles.push(L, v.h, v.ty); return;
    // A `code` is an identity: push something the engine will read back as the same name.
    // A Lua map function handed over is registered as a host function, so both directions
    // use the one table and a value that round-trips through Lua still works as a `code`.
    case "code": b.pushNamedFunction(L, v.fn); return;
    default: lua.lua_pushnil(L); return;
  }
}

/** One Lua stack slot as a JASS value. */
export function readValue(L: LuaState, i: number, b: ValueBridge): JassValue {
  switch (lua.lua_type(L, i)) {
    case lua.LUA_TBOOLEAN:
      return jBool(lua.lua_toboolean(L, i));
    // Lua 5.3 keeps integers and floats apart, and so does JASS — `7/2` is 3 in one and 3.5
    // in the other. Carrying the distinction across rather than guessing is why the value
    // model has two numeric kinds (jass/values.ts).
    case lua.LUA_TNUMBER:
      return lua.lua_isinteger(L, i) ? jInt(lua.lua_tointeger(L, i)) : jReal(lua.lua_tonumber(L, i));
    case lua.LUA_TSTRING:
      return jStr(to_jsstring(lua.lua_tostring(L, i)));
    case lua.LUA_TLIGHTUSERDATA:
    case lua.LUA_TUSERDATA:
      return b.handles.read(L, i);
    case lua.LUA_TFUNCTION: {
      const known = b.nameOfEngineFunction(L, i);
      return { k: "code", fn: known ?? b.functionName(L, i) };
    }
    default:
      return JNULL;
  }
}
