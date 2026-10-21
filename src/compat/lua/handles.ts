import { lua, lauxlib, to_luastring, type LuaState } from "fengari";
import { jHandle, JNULL, type JassValue } from "../../jass/values";

// How a JASS `handle` crosses into Lua (docs/lua-engine-port.md §4.4).
//
// The original YD engine has three levels, selected at runtime by
// `jass.runtime.handle_level` (yd_lua_engine/class_handle.cpp:163-202):
//
//   0  a raw integer — no safety, and `0` means null the way JASS means it
//   1  a LIGHT userdata — identity only, comparable, `tostring`-able
//   2  a userdata with a metatable — the YD default, where the original's __gc
//      decrements the engine's handle refcount
//
// We keep one interned box per handle id at every level, so Lua `==` is the handle identity
// JASS `==` is. Level 2 has no refcount to decrement (the JS handle table owns lifetime), so
// its `__gc` is deliberately absent rather than a lie.
//
// A null handle is `nil`, never a box for id 0: YD's level-2 documentation says "0 no longer
// converts implicitly to nil; use nil for null", and our own `_G` bridge must agree.

export type HandleMode = 0 | 1 | 2;

export interface HandleCodec {
  readonly mode: HandleMode;
  /** Push a handle id. `h <= 0` pushes nil. */
  push(L: LuaState, h: number, ty: string): void;
  /** Read a handle at `i`; JNULL for nil/none/non-handles. */
  read(L: LuaState, i: number): JassValue;
  /** The id alone, or 0 when nil/non-handle. */
  idOf(L: LuaState, i: number): number;
  /** Drop the interned boxes (they belong to one state). */
  reset(): void;
}

const LUA_NOREF = -2;

export function createHandleCodec(mode: HandleMode): HandleCodec {
  if (mode === 0) {
    return {
      mode,
      push(L, h) {
        if (h <= 0) lua.lua_pushnil(L);
        else lua.lua_pushinteger(L, h);
      },
      read(L, i) {
        if (lua.lua_type(L, i) === lua.LUA_TNIL || lua.lua_type(L, i) === lua.LUA_TNONE) return JNULL;
        const h = lua.lua_tointeger(L, i);
        return h > 0 ? jHandle(h, "handle") : JNULL;
      },
      idOf(L, i) {
        if (lua.lua_type(L, i) !== lua.LUA_TNUMBER) return 0;
        const h = lua.lua_tointeger(L, i);
        return h > 0 ? h : 0;
      },
      reset() {},
    };
  }

  if (mode === 1) {
    const boxes = new Map<number, { h: number; ty: string }>();
    return {
      mode,
      push(L, h, ty) {
        if (h <= 0) { lua.lua_pushnil(L); return; }
        let box = boxes.get(h);
        if (!box) { box = { h, ty }; boxes.set(h, box); }
        lua.lua_pushlightuserdata(L, box);
      },
      read(L, i) {
        const t = lua.lua_type(L, i);
        if (t !== lua.LUA_TLIGHTUSERDATA) return JNULL;
        const box = lua.lua_touserdata(L, i) as { h?: unknown; ty?: unknown } | null;
        return box && typeof box.h === "number" && box.h > 0
          ? jHandle(box.h, typeof box.ty === "string" ? box.ty : "handle")
          : JNULL;
      },
      idOf(L, i) {
        if (lua.lua_type(L, i) !== lua.LUA_TLIGHTUSERDATA) return 0;
        const box = lua.lua_touserdata(L, i) as { h?: unknown } | null;
        return box && typeof box.h === "number" ? box.h : 0;
      },
      reset() { boxes.clear(); },
    };
  }

  // --- level 2: full userdata, interned -------------------------------------------------
  interface Box { h: number; ty: string }
  const dataOf = (L: LuaState, i: number): Box | null => {
    const d = lua.lua_touserdata(L, i) as Box | null;
    return d && typeof d.h === "number" ? d : null;
  };

  let mtRef = LUA_NOREF;
  const byId = new Map<number, { ref: number; data: Box }>();

  const makeMetatable = (L: LuaState): void => {
    if (mtRef !== LUA_NOREF) return;
    lua.lua_newtable(L);
    lua.lua_pushjsfunction(L, (S) => {
      const a = dataOf(S, 1), b = dataOf(S, 2);
      lua.lua_pushboolean(S, !!a && !!b && a.h === b.h);
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring("__eq"));
    lua.lua_pushjsfunction(L, (S) => {
      const d = dataOf(S, 1);
      lua.lua_pushstring(S, to_luastring(d ? `handle: 0x${d.h.toString(16).toUpperCase()}` : "handle: 0x0"));
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring("__tostring"));
    mtRef = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
  };

  return {
    mode,
    push(L, h, ty) {
      if (h <= 0) { lua.lua_pushnil(L); return; }
      const known = byId.get(h);
      if (known) {
        lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, known.ref);
        return;
      }
      makeMetatable(L);
      const data = lua.lua_newuserdata(L, 4) as unknown as Box;
      data.h = h;
      data.ty = ty;
      lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, mtRef);
      lua.lua_setmetatable(L, -2);
      lua.lua_pushvalue(L, -1);
      const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
      byId.set(h, { ref, data });
    },
    read(L, i) {
      const t = lua.lua_type(L, i);
      if (t !== lua.LUA_TUSERDATA && t !== lua.LUA_TLIGHTUSERDATA) return JNULL;
      const d = dataOf(L, i);
      return d && d.h > 0 ? jHandle(d.h, d.ty || "handle") : JNULL;
    },
    idOf(L, i) {
      const d = dataOf(L, i);
      return d ? d.h : 0;
    },
    reset() {
      byId.clear();
      mtRef = LUA_NOREF;
    },
  };
}
