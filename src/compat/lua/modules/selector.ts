import { lua, to_luastring, type LuaState } from "fengari";
import { jHandle } from "../../../jass/values";
import type { LuaModuleHost } from "../host";

// `jass.selector` (docs/lua-engine-port.md §5.8; yd_lua_engine/libs_selector.cpp).
//
// The original walks CGameUI's unit table and sniffs the vtable. Our answer is the runtime's
// own unit list plus the engine's own `IsUnitType(u, UNIT_TYPE_HERO)` — the same question a
// JASS trigger asks, so a morph, a custom hero type and a dead/removed unit are all handled
// by the engine rather than by a second classification.

export function open(host: LuaModuleHost, S: LuaState): void {
  lua.lua_newtable(S);

  lua.lua_pushstring(S, to_luastring("hero"));
  lua.lua_pushjsfunction(S, (C) => {
    const heroType = host.rt.globals.get("UNIT_TYPE_HERO");
    lua.lua_createtable(C, 0, 0);
    if (heroType === undefined) {
      host.warnOnce("selector:hero", "UNIT_TYPE_HERO is not loaded — empty hero list");
      return 1;
    }
    let n = 0;
    for (const u of host.rt.units) {
      if (u.removed) continue;
      const h = jHandle(u.handleId, "unit");
      const isHero = host.interp.callFunction("IsUnitType", [h, heroType]);
      if (isHero.k !== "bool" || !isHero.b) continue;
      host.push(C, h);
      lua.lua_rawseti(C, -2, ++n);
    }
    return 1;
  });
  lua.lua_rawset(S, -3);
}
