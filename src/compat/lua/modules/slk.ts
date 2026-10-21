import { lua, lauxlib, to_jsstring, to_luastring, type LuaState } from "fengari";
import { MappedData } from "mdx-m3-viewer/dist/cjs/utils/mappeddata";
import { intToRawcode } from "../../../jass/lexer";
import { wc3TextDecoder } from "../../../vfs/text";
import type { LuaModuleHost } from "../host";

// `jass.slk` — the install's own tables, read raw (docs/lua-engine-port.md §5.10;
// yd_lua_engine/libs_slk.cpp). Eight table names, each an object-id index into a row whose
// columns are the SLK/INI names a map's tooling expects. Values are STRINGS, as
// `SlkValue::to_string` returns them.
//
// Read from `options.install`, never from the map: this is the game's data, and a map's
// custom object rows are already applied where the engine reads them (the object overlay).
// `misc` merges MiscData.txt and MiscGame.txt — the latter is the gameplay-constant file, so
// a script asking for `Misc.DefenseArmor` gets the value the edition/patch chain would use.
//
// MappedData lowercases every key. The Lua row therefore stores lowercased keys and its
// `__index` lowercases the script's key, so `row.HP` and `row.hp` are the same column.

type Row = { map: Record<string, string> };

const FILES: Record<string, string[]> = {
  ability: ["Units\\AbilityData.slk"],
  buff: ["Units\\AbilityBuffData.slk"],
  unit: ["Units\\UnitData.slk", "Units\\UnitBalance.slk", "Units\\UnitUI.slk", "Units\\UnitWeapons.slk"],
  item: ["Units\\ItemData.slk"],
  upgrade: ["Units\\UpgradeData.slk"],
  doodad: ["Units\\DoodadData.slk"],
  destructable: ["Units\\DestructableData.slk"],
  misc: ["Units\\MiscData.txt", "Units\\MiscGame.txt"],
};

export function open(host: LuaModuleHost, S: LuaState): void {
  const cache = new Map<string, Map<string, Row> | null>();
  const rowRefs = new Map<string, number>();

  const load = (kind: string): Map<string, Row> | null => {
    if (cache.has(kind)) return cache.get(kind) ?? null;
    const paths = FILES[kind];
    const install = host.options.install;
    if (!paths || !install) { cache.set(kind, null); return null; }
    const data = new MappedData();
    let any = false;
    for (const path of paths) {
      const bytes = install.rawBytes(path);
      if (!bytes) continue;
      let text = wc3TextDecoder().decode(bytes);
      // IniFile splits on CRLF alone; the SLK parser does not care.
      if (path.toLowerCase().endsWith(".txt")) text = text.replace(/\r?\n/g, "\r\n");
      data.load(text);
      any = true;
    }
    if (!any) { cache.set(kind, null); return null; }
    const rows = new Map<string, Row>();
    for (const [id, row] of Object.entries(data.map)) rows.set(id.toLowerCase(), row as Row);
    cache.set(kind, rows);
    return rows;
  };

  const rowTable = (C: LuaState, kind: string, id: string, row: Row): void => {
    const key = `${kind}:${id}`;
    const known = rowRefs.get(key);
    if (known !== undefined) { lua.lua_rawgeti(C, lua.LUA_REGISTRYINDEX, known); return; }

    lua.lua_newtable(C);
    for (const [k, v] of Object.entries(row.map)) {
      lua.lua_pushstring(C, to_luastring(k));
      lua.lua_pushstring(C, to_luastring(v));
      lua.lua_rawset(C, -3);
    }
    lua.lua_newtable(C);
    lua.lua_pushstring(C, to_luastring("__index"));
    lua.lua_pushjsfunction(C, (T) => {
      const raw = lua.lua_tolstring(T, 2);
      if (!raw) { lua.lua_pushnil(T); return 1; }
      const look = to_jsstring(raw).toLowerCase();
      lua.lua_pushstring(T, to_luastring(look));
      lua.lua_rawget(T, 1);
      return 1;
    });
    lua.lua_rawset(C, -3);
    lua.lua_setmetatable(C, -2);

    lua.lua_pushvalue(C, -1);
    rowRefs.set(key, lauxlib.luaL_ref(C, lua.LUA_REGISTRYINDEX));
  };

  const iteratorFor = (C: LuaState, kind: string, ids: string[], rows: Map<string, Row>): number => {
    const state = { ids, i: 0 };
    lua.lua_pushjsfunction(C, (T) => {
      const st = lua.lua_touserdata(T, 1) as { ids: string[]; i: number };
      if (!st || st.i >= st.ids.length) { lua.lua_pushnil(T); return 1; }
      const id = st.ids[st.i++];
      const row = rows.get(id);
      if (!row) { lua.lua_pushnil(T); return 1; }
      lua.lua_pushstring(T, to_luastring(id));
      rowTable(T, kind, id, row);
      return 2;
    });
    lua.lua_pushlightuserdata(C, state);
    lua.lua_pushnil(C);
    return 3;
  };

  const kindTable = (C: LuaState, kind: string): void => {
    lua.lua_newtable(C);
    lua.lua_newtable(C);

    lua.lua_pushstring(C, to_luastring("__index"));
    lua.lua_pushjsfunction(C, (T) => {
      const rows = load(kind);
      if (!rows) { lua.lua_pushnil(T); return 1; }
      const t = lua.lua_type(T, 2);
      const id =
        t === lua.LUA_TSTRING ? (lua.lua_tolstring(T, 2) ? to_jsstring(lua.lua_tolstring(T, 2)) : "")
        : t === lua.LUA_TNUMBER ? intToRawcode(lua.lua_tointeger(T, 2))
        : "";
      const row = id ? rows.get(id.toLowerCase()) : undefined;
      if (!row) { lua.lua_pushnil(T); return 1; }
      rowTable(T, kind, id.toLowerCase(), row);
      return 1;
    });
    lua.lua_rawset(C, -3);

    lua.lua_pushstring(C, to_luastring("__newindex"));
    lua.lua_pushjsfunction(C, () => 0);
    lua.lua_rawset(C, -3);

    lua.lua_pushstring(C, to_luastring("__pairs"));
    lua.lua_pushjsfunction(C, (T) => {
      const rows = load(kind);
      if (!rows) { lua.lua_pushnil(T); return 1; }
      return iteratorFor(T, kind, [...rows.keys()].sort(), rows);
    });
    lua.lua_rawset(C, -3);

    lua.lua_setmetatable(C, -2);

    // `factory` is a FIELD of the proxy table (YD sets it after the metatable), the same
    // iterator `pairs` returns.
    lua.lua_pushstring(C, to_luastring("factory"));
    lua.lua_pushjsfunction(C, (T) => {
      const rows = load(kind);
      if (!rows) { lua.lua_pushnil(T); return 1; }
      return iteratorFor(T, kind, [...rows.keys()].sort(), rows);
    });
    lua.lua_rawset(C, -3);
  };

  lua.lua_newtable(S);
  for (const kind of Object.keys(FILES)) {
    lua.lua_pushstring(S, to_luastring(kind));
    kindTable(S, kind);
    lua.lua_rawset(S, -3);
  }
}
