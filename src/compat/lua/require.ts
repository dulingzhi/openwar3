import { lua, lauxlib, to_jsstring, to_luastring, type LuaState } from "fengari";

// `require` for a map's Lua modules (docs/lua-engine-port.md §5.1).
//
// The original replaces Lua's searchers with Storm and file searchers
// (yd_lua_engine/libs_package.cpp). We keep Lua's own `require`/`package` semantics and replace
// the two SEARCHERS a browser can answer:
//
//   * a PRELOAD table — the engine's `jass.*` modules, registered by host.ts;
//   * the MAP ARCHIVE — a module the map ships, read with `options.map.rawBytes`.
//
// There is no disk searcher, no install searcher and no DLL searcher. The lookup is guarded
// before it reaches the archive (no absolute paths, no drive letters, no `..` segments), so a
// script cannot turn `require` into a file-system read even if a future DataSource is broader
// than the map.
//
// `require` itself is written in Lua (below) because caching, the nil→true rule and the loop
// guard are Lua's own semantics; the two C functions it calls only FIND and LOAD.

const REQUIRE_LUA = `
package = { loaded = {}, preload = {}, path = "?.lua;lua/?.lua;scripts/?.lua" }

local loading = {}

function require(name)
  if type(name) ~= 'string' then
    error("bad argument #1 to 'require' (string expected)", 2)
  end
  local v = package.loaded[name]
  if v ~= nil then return v end
  if loading[name] then
    error("loop or previous error loading module '" .. name .. "'", 0)
  end

  loading[name] = true
  local ok, err = pcall(function()
    local loader = package.preload[name]
    if type(loader) ~= 'function' then
      local why
      loader, why = __ow3_map_loader(name)
      if type(loader) ~= 'function' then
        error(why or ("module '" .. name .. "' not found"), 0)
      end
    end
    local result = loader(name)
    if result == nil then result = true end
    package.loaded[name] = result
  end)
  loading[name] = nil
  if not ok then error(err, 0) end
  return package.loaded[name]
end
`;

/** What `installRequire` needs from the host. */
export interface RequireCtx {
  L: LuaState;
  map?: { rawBytes(path: string): Uint8Array | null };
  warnOnce(key: string, msg: string): void;
}

export interface RequireApi {
  /** Require a module from JavaScript (the `exec-lua:` door). Returns false on a Lua error. */
  requireModule(name: string): boolean;
}

/** Refuse anything that could walk out of the map archive. */
export function safeModulePath(path: string): boolean {
  if (!path) return false;
  if (path.includes("..")) return false;
  if (path.includes(":")) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  return true;
}

/** The path templates a module name expands to, in order. */
export function moduleCandidates(name: string, path: string): string[] {
  const out: string[] = [];
  const forms = [name.replace(/\./g, "/"), name.replace(/\./g, "\\")];
  for (const template of path.split(";")) {
    const t = template.trim();
    if (!t) continue;
    for (const form of forms) {
      const file = t.includes("?") ? t.replace(/\?/g, form) : `${t}/${form}`;
      if (safeModulePath(file) && !out.includes(file)) out.push(file);
    }
  }
  return out;
}

export function installRequire(
  ctx: RequireCtx,
  preloads: ReadonlyMap<string, (L: LuaState) => void>,
): RequireApi {
  const { L } = ctx;

  /** `__ow3_map_loader(name)` — the compiled chunk, or nil + "no file …" message. */
  lua.lua_pushjsfunction(L, (S) => {
    const raw = lua.lua_tolstring(S, 1);
    const name = raw ? to_jsstring(raw) : "";

    // The templates are the SCRIPT's (`package.path`), read live: a map may extend it before
    // its first require, exactly as it would in a plain Lua program.
    lua.lua_getglobal(S, to_luastring("package"));
    lua.lua_getfield(S, -1, to_luastring("path"));
    const pathV = lua.lua_tolstring(S, -1);
    const path = pathV ? to_jsstring(pathV) : "?.lua;lua/?.lua;scripts/?.lua";
    lua.lua_pop(S, 2);

    const tried: string[] = [];
    for (const file of moduleCandidates(name, path)) {
      const bytes = ctx.map?.rawBytes(file);
      if (!bytes) { tried.push(file); continue; }
      const stat = lauxlib.luaL_loadbuffer(S, bytes, null, to_luastring(`@${file}`));
      if (stat !== lua.LUA_OK) {
        // The chunk's compile error is already on the stack; let Lua's pcall carry it.
        return lua.lua_error(S);
      }
      return 1;
    }

    const where = tried.length
      ? `\n\tno file '${tried[0]}'${tried.length > 1 ? ` (and ${tried.length - 1} more)` : ""}`
      : "\n\tpackage.path is empty";
    lua.lua_pushnil(S);
    lua.lua_pushstring(S, to_luastring(`module '${name}' not found:${where}`));
    return 2;
  });
  lua.lua_setglobal(L, to_luastring("__ow3_map_loader"));

  // The Lua half. `SANDBOX_REMOVE` no longer takes `package`/`require`; io/os/load stay gone.
  if (lauxlib.luaL_loadbuffer(L, to_luastring(REQUIRE_LUA), null, to_luastring("@openwar3-lua-require")) !== lua.LUA_OK) {
    const msg = lua.lua_gettop(L) ? to_jsstring(lua.lua_tolstring(L, -1) ?? new Uint8Array()) : "load failed";
    lua.lua_pop(L, 1);
    throw new Error(`require prologue: ${msg}`);
  }
  if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    const msg = lua.lua_gettop(L) ? to_jsstring(lua.lua_tolstring(L, -1) ?? new Uint8Array()) : "run failed";
    lua.lua_pop(L, 1);
    throw new Error(`require prologue: ${msg}`);
  }

  // Publish the built-in loaders into `package.preload` as closures. They stay in the table
  // (not in `_G`), so `require` finds them exactly the way it finds a map module.
  for (const name of preloads.keys()) {
    lua.lua_getglobal(L, to_luastring("package"));
    lua.lua_getfield(L, -1, to_luastring("preload"));
    lua.lua_pushstring(L, to_luastring(name));
    lua.lua_pushjsfunction(L, (S) => {
      const open = preloads.get(name);
      if (!open) { lua.lua_pushnil(S); return 1; }
      open(S);
      return 1;
    });
    lua.lua_rawset(L, -3);
    lua.lua_pop(L, 2);
  }

  return {
    requireModule(name: string): boolean {
      lua.lua_getglobal(L, to_luastring("require"));
      lua.lua_pushstring(L, to_luastring(name));
      if (lua.lua_pcall(L, 1, 1, 0) !== lua.LUA_OK) {
        const msg = lua.lua_gettop(L) ? to_jsstring(lua.lua_tolstring(L, -1) ?? new Uint8Array()) : "?";
        lua.lua_pop(L, 1);
        ctx.warnOnce(`require:${name}`, msg);
        return false;
      }
      lua.lua_pop(L, 1);
      return true;
    },
  };
}
