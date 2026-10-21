# Lua engine port — implementation steps

This is the execution document for [`docs/lua-engine-port.md`](./lua-engine-port.md). The
design document says **what** and **why**; this one says **in what order**, **in which file**,
**with what code**, and **how it is proved**.

**Status: pre-implementation.** Every step below is meant to be one commit. A step that
cannot be finished without changing a contract in the design document stops and amends the
design document first.

---

## 0. Ground rules

### 0.1 Gates

Every step ends with:

```
pnpm typecheck
pnpm jass:test
node tools/map-compat.cjs --check     # the install's own maps must stay unaffected
```

The Lua test needs the JASS build and the developer's own install:

```
npx tsc -p tools/tsconfig.jass.json
node tools/jass-lua-test.cjs
```

### 0.2 Invariants

1. **No JASS map changes behaviour.** Nothing in `src/jass/` may start doing work only
   because this layer exists. New hooks/methods are optional (`?`) and unset for a normal
   match.
2. **No official Lua map changes behaviour** except where a step says so explicitly
   (notably `require` existing, `debug.traceback` existing, and `math.random` moving to the
   game's RNG).
3. **`src/compat/` stays removable.** It may import `src/jass`, `src/world`, `src/data`,
   `src/vfs`; it may not import `src/render`, `src/game`, `src/ui`. Anything from those
   arrives as an injected interface.
4. **One step, one commit.** Suggested subjects are given per step.
5. **Tests are assertions, not logs.** A step's test prints `ok`/`FAIL` and exits non-zero on
   failure, like the existing `tools/jass-lua-test.cjs`.

### 0.3 Dependency graph

```
S0 survey (optional, parallel)
S1 refactor ─ S2 options ─ S3 require ─┬─ S4 common ─┬─ S6 runtime ─ S7 debug
                                       └─ S5 globals ┘
                                                     S8 hook
                                                     S9 JAPI registry ─ S10 exec-lua/console
                                                          │
                          S11 damage ─ S12 item ─ S13 ability ─ S14 unit state   (pack A)
                                                     S15 selector
                                                     S16 code
                                                     S17 slk
                                                     S18 message
                                                     S19 stubs/dispose/docs
```

S3–S8 can be reviewed independently; S9 is the first step that depends on the module
scaffolding from S3. S11–S14 depend on S9 only for registration, not for behaviour.

---

## S0 — Corpus survey tool

**Commit:** `tools: scan maps for YD Lua and JAPI call sites`

### Goal

Rank the work by what maps actually call. The output decides the contents of JAPI pack A and
whether S15–S18 are worth doing at all.

### Files

* new: `tools/lua-usage-scan.mjs`

### Details

1. Accept `--maps <dir-or-file>...` and `--out <json>`.
2. Open each map with the existing VFS path (`openMapArchive` / `MapFileLayer`) rather than a
   second MPQ reader. Reuse `tools/map-compat.cjs`'s map discovery if it already enumerates
   the install.
3. For every map, read:
   * `war3map.j`, `scripts\war3map.j`
   * `war3map.lua`, `scripts\war3map.lua`
   * every `*.lua` entry in `list()`
4. Extract with regexes, over both dialects:
   * module requires: `require%s*%(?%s*["']([%w%._%-]+)["']`
   * `jass.<module>` references: `jass%.([%w_]+)`
   * JAPI calls: `%f[%w]([ED][Xz]%u[%w_]*)` (covers `EX*` and `Dz*`)
   * unit-data indices: `EXSetUnit(?:Integer|Real|String|ArrayString)%s*%(%s*[^,]+%s*,%s*(%d+)`
   * entry points: `exec%-lua:` and `war3map%.lua`
5. Write JSON:

```json
{
  "maps": 210,
  "modules": { "jass.common": 41, "jass.globals": 12, "jass.runtime": 38 },
  "japi": { "EXGetUnitAbility": 33, "EXSetUnitInteger": 9, "DzFrameSetText": 4 },
  "unitDataIndices": { "10": 9, "61": 9, "999": 1 },
  "entry": { "exec-lua": 7, "war3map.lua": 3 }
}
```

### Done when

The report exists and names the top 20 JAPI names and every unit-data index seen. No repo
code outside `tools/` changed.

---

## S1 — Split the host into a facade, values and a handle codec

**Commit:** `lua: split host values/handles and expose a module facade`

### Goal

Prepare for modules with **zero behaviour change**. This is a pure refactor and the existing
test must pass untouched.

### Files

* new: `src/compat/lua/values.ts`
* new: `src/compat/lua/handles.ts`
* edit: `src/compat/lua/host.ts`
* edit: `src/compat/lua/fengari.d.ts`

### Details

#### 1. `handles.ts`

```ts
export type HandleMode = 0 | 1 | 2;

export interface HandleCodec {
  mode: HandleMode;
  /** Push a handle id. id <= 0 pushes nil, as YD does. */
  push(L: LuaState, h: number, ty: string): void;
  /** Read a handle at index, JNULL for nil/none. */
  read(L: LuaState, i: number): JassValue;
  /** The id alone, or 0. */
  idOf(L: LuaState, i: number): number;
}

export function createHandleCodec(rt: Runtime, mode: HandleMode): HandleCodec;
```

* mode 0: `lua_pushinteger` / `lua_tointeger`.
* mode 1 (current behaviour): interned light userdata boxes `{h, ty}` in a
  `Map<number, {h,ty}>`. Keep this as the default in S1 so nothing changes.
* mode 2: added in S1 but only reachable through the new option; interned **full userdata**
  holding 4 bytes of id, with a `jhandle_t` metatable (`__eq`, `__tostring`, `__gc` no-op).
  Check first that `lua_newuserdata(L, 4)` returns a writable buffer in fengari
  (`lua_touserdata` must return that same buffer); if it does not, keep mode 2 as a
  metatable over the interned light-userdata box and record the divergence.

#### 2. `values.ts`

```ts
export interface ValueBridge {
  handles: HandleCodec;
  /** Register a Lua function with the engine; returns its host name. */
  functionName(L: LuaState, i: number): string;
  /** Push the closure for a host function name. */
  pushNamedFunction(L: LuaState, name: string): void;
  /** Look up the host name of an engine closure, or null. */
  nameOfEngineFunction(L: LuaState, i: number): string | null;
}

export function pushValue(L: LuaState, v: JassValue, b: ValueBridge): void;
export function readValue(L: LuaState, i: number, b: ValueBridge): JassValue;
```

Move the existing `push`/`read` bodies verbatim, with two deliberate changes. Both are stated
here because they are the only behaviour this refactor touches, and both get an assertion:

* `handle` with id ≤ 0 → `nil` (the YD rule). Existing tests use real handles.
* `code` pushes a **closure** rather than a string:
  `pushNamedFunction(L, v.fn)`; `readValue` on a function asks
  `nameOfEngineFunction` first, and only then `functionName` (a map function handed over).
  A `code` value that round-trips through Lua is then usable by a native that expects one.

#### 3. `host.ts` facade

```ts
export interface LuaHost {
  readonly L: LuaState;
  readonly interp: Interpreter;
  readonly rt: Runtime;
  readonly seed: number;
  readonly options: LuaHostOptions;   // S2
  push(L: LuaState, v: JassValue): void;
  read(L: LuaState, i: number): JassValue;
  pushEngineClosure(L: LuaState, name: string): void;
  functionName(L: LuaState, i: number): string;
  pushNamedFunction(L: LuaState, name: string): boolean;
  nameOfEngineFunction(L: LuaState, i: number): string | null;
  /** Call a Lua function synchronously (no yield); reports errors via reportError. */
  callLua(L: LuaState, fnIndex: number, args: JassValue[]): JassValue;
  reportError(msg: string): void;
  warnOnce(key: string, msg: string): void;
}
```

Keep `createLuaMapScript(interp, seed)` working; internals construct a `LuaHost` and hand it to
the existing code paths.

`engineClosure(name)` additionally records `jsFunction → name` in a `WeakMap` so
`nameOfEngineFunction` can answer `jass.debug.functiondef` without upvalues. Verify
`lua_tocfunction` returns the JS function pushed by `lua_pushjsfunction`; if it does not, use a
registry table keyed by the function instead.

#### 4. `fengari.d.ts`

Add the C API names used from here on. Confirmed present in the installed fengari:

`lua_pushcclosure`, `lua_tocfunction`, `lua_setfield`, `lua_getfield`, `lua_rawgetp`,
`lua_rawsetp`, `lua_rawseti`, `lua_rawgeti`, `lua_next`, `lua_isnil`, `lua_isuserdata`,
`lua_getmetatable`, `lua_newuserdata`, `lua_upvalueindex`, `lua_tolstring`, `lua_getupvalue`,
`lua_setupvalue`, `lua_error`, plus `lauxlib.luaL_newmetatable`, `luaL_setfuncs`,
`luaL_checkudata`, `luaL_loadstring`.

### Tests

Existing `tools/jass-lua-test.cjs` passes **unchanged**. Add:

```
check('handle identity survives the refactor', call('handles').b, true)
check('null handle is nil', ..., ...)   // after S1's push rule
```

### Done when

`pnpm typecheck`, the existing 10 assertions and `jass:test` pass; `git diff` contains no
semantic change outside the moved code.

---

## S2 — Options and wiring

**Commit:** `lua: thread map/install/input options into the Lua host`

### Goal

Give the host the three things it cannot discover: the map archive, the install, and the
app-side bridges.

### Files

* edit: `src/compat/lua/host.ts`
* edit: `src/jass/index.ts`
* edit: `src/render/mapViewer.ts` (only if the call site must pass the map layer)

### Details

```ts
export interface LuaHostOptions {
  map?: { rawBytes(path: string): Uint8Array | null };
  install?: { rawBytes(path: string): Uint8Array | null };
  input?: LuaInputBridge;              // S18; declared now as an empty interface
  log?: (level: string, text: string) => void;
  sleep?: boolean;                     // default true (design §8.1)
  handleLevel?: 0 | 1 | 2;             // default 2
}
export function createLuaMapScript(interp, seed, options?: LuaHostOptions): LuaMapScript;
```

`loadMapScript` already has `install: DataSource` and `map: MpqDataSource`
(`src/jass/index.ts:loadMapScript`). Pass `{ map, install }` at the `createLuaMapScript` call
(line ~141). Do **not** pass the renderer; `mapViewer.ts` passes `input`/`log` through the
`loadMapScript` options when it has them.

Add `LuaMapScript.require(name: string): JassValue` (used by `exec-lua:`, S10) and a
`dispose()` that also clears every registry ref this layer created (S19 fills in the rest).

### Tests

Headless: construct an in-memory `{ rawBytes }` object and assert the host accepts it without
touching the real install. Existing test unaffected.

### Done when

The host receives the map source; no module exists yet; `jass:test` passes.

---

## S3 — `require`, `package` and the map searcher

**Commit:** `lua: add require/package with a map-archive searcher`

### Goal

The YD entry point. `require "jass.common"` and `require "blizzard"` must work; the sandbox
must stay closed.

### Files

* new: `src/compat/lua/require.ts`
* edit: `src/compat/lua/host.ts` (install it; remove `require`/`package` from
  `SANDBOX_REMOVE`, keep `io`, `os`, `load`, `loadfile`, `dofile`, `loadstring`,
  `collectgarbage` removed)
* edit: `src/compat/lua/fengari.d.ts` if needed

### Details

#### 1. The `package` table

Create it in JS (not in the prologue) so paths stay guarded:

```
package = {
  loaded  = {},             -- name -> value (Lua table, inspectable)
  preload = {},             -- name -> loader function
  path    = "?.lua;lua/?.lua;scripts/?.lua",
  cpath   = nil,            -- does not exist
}
```

Keep a JS `Map<string, (host: LuaHost) => void>` of built-in loaders; each pushes exactly one
value. `package.preload[name]` is a Lua closure that calls the same loader, so scripts can
inspect it.

#### 2. `require(name)` algorithm

```
if type(name) ~= "string" then error("bad argument #1 to 'require' (string expected)")
if package.loaded[name] ~= nil then return package.loaded[name]
if loading[name] then error("loop or previous error loading module '"..name.."'")
loading[name] = true
local loader, where = first_searcher(name)
if not loader then error("module '"..name.."' not found:"..where)
local result = loader(name)
if result == nil then result = true end
package.loaded[name] = result
loading[name] = nil
return result
```

#### 3. Searchers

1. **preload**: built-ins (`jass.common`, …), then the map's own `package.preload` if a script
   wrote one (raw table lookup).
2. **map archive**: for each `;`-separated template in `package.path`, substitute `?` with
   `name` using dots → `/` (and also dots → `\`), then read with
   `options.map.rawBytes(path)`.
   * `normalizePath`: reject a path containing a `..` segment, a leading `/` or `\`, or `:`;
     collapse repeated separators.
   * Load the bytes with `luaL_loadbuffer(L, bytes, null, "@"+path)` — **no decoding**, so a
     UTF-8 module is byte-exact.
   * On success `lua_pcall(L, 1, 1)` with the module name as its argument; on failure propagate
     `@path: message`.
   * `nil` result → `true`.
   * Collect the tried paths for the error message.
3. No DLL searcher, no install searcher, no disk.

#### 4. Built-in modules

`PRELOAD` starts with the modules implemented in S4–S9; each `modules/*.ts` exports
`open(host): void` that pushes a table. Register them here by name. `blizzard` is registered
lazily in S9 as a proxy over `rt.functions` only if the map did not ship one — do that in the
searcher, not here.

### Tests

```
-- module from a fake map archive
local b = require "blizzard"
check(b.TriggerRegisterAnyUnitEventBJ ~= nil)

-- preload
package.loaded["jass.common"] = nil
check(type(require "jass.common") == "table")

-- guarded paths
check(not pcall(require, "../../secret"))
check(not pcall(require, "does.not.exist"))

-- sandbox unchanged otherwise
check(io == nil and os == nil and load == nil and dofile == nil)
check(type(debug.traceback) == "function")   -- S6 adds the library; see there
```

Also update the existing `sandbox` assertion: `require` is no longer nil; the other doors stay
nil.

### Done when

A fake archive module loads; a missing module produces Lua's usual message; a traversal is
refused; `jass:test` passes.

---

## S4 — `jass.common`

**Commit:** `lua: jass.common proxy over natives and globals`

### Files

* new: `src/compat/lua/modules/common.ts`
* edit: `src/compat/lua/require.ts` (register)

### Details

Metatable:

```lua
{
  __index    = get,
  __newindex = set,
  __pairs    = pairs,
}
```

`get(L)`:

1. key must be a string; otherwise `nil`.
2. `rt.globals.get(key)` → live push (never cache a value).
3. `rt.globalArrays.get(key)` → array proxy (S5).
4. `rt.natives.has(key) || rt.nativeReturns.has(key) || rt.japi.has(key)` → cached engine
   closure.
5. `nil`.

**Closure cache.** A JS `Map<string, number>` of `name → luaL_ref`; push with
`lua_rawgeti(L, LUA_REGISTRYINDEX, ref)`. Do **not** rawset into the module table: a cached
key would swallow a later `CJ.Foo = value` (`__newindex` only fires for absent keys).

`set(L, key, value)`:

* a string key that names an existing scalar global → `rt.assignGlobal(key, read(value))`;
  return 0.
* an array name → ignore (YD's `jass_set` does nothing for arrays).
* unknown name → ignore (do not invent a global).

`pairs(L)`:

* snapshot `rt.natives` + `rt.nativeReturns` names, **sort** them, push an iterator whose
  state is `{ names, i }` in a light userdata; values are the same cached closures.

### Tests

```
local CJ = require "jass.common"
check(type(CJ.CreateTrigger) == "function")
check(CJ.EVENT_PLAYER_UNIT_SPELL_EFFECT == EVENT_PLAYER_UNIT_SPELL_EFFECT)
check(type(CJ.bj_MAX_PLAYERS) == "number")
CJ.someExistingGlobal = 5
check(someExistingGlobal == 5)
check(CJ.NOT_A_REAL_NAME == nil)
```

### Done when

Constants, natives, BJs (through `rt.functions` when the name is a function) and live globals
all answer; writes go through `assignGlobal`; pairs is deterministic.

---

## S5 — `jass.globals` and the array proxy

**Commit:** `lua: live JASS globals and array proxies`

### Files

* new: `src/compat/lua/jarray.ts`
* new: `src/compat/lua/modules/globals.ts`
* edit: `src/compat/lua/require.ts`

### Details

#### Array proxy (`jarray.ts`)

One metatable `jarray_t` per state:

```lua
__index    = function(t, i)  -- raw 0-based
__newindex = function(t, i, v)
__len      = function(t) return 8192 end
```

* The backing `JassArray` object is stored in the table under a **unique light-userdata key**
  (not a string), so a script cannot accidentally overwrite it.
* Bounds: `0 <= i < 8192` (`JASS_MAX_ARRAY_SIZE`). Out of range reads `nil`; writes are
  ignored.
* Reads return the array's own default (`JassArray.get`), which is what makes
  `udg_A[7] + 1` work unwritten.
* It is a **view**: the same `JassArray` object is read and written by the interpreter.

#### `jass.globals`

* `__index`: scalar global → live; array → proxy; else nil.
* `__newindex`: scalar → `assignGlobal`; array → ignored; unknown → ignored.
* `__pairs`: sorted `rt.globals` + `rt.globalArrays` names.

### Tests

```
local G = require "jass.globals"
check(G.bj_MAX_PLAYERS == 12)
G.bj_isSinglePlayer = true
check(bj_isSinglePlayer == true)
local a = G.udg_TestArray
a[3] = 7
check(a[3] == 7 and a[4] == 0)     -- default by type
check(#a == 8192)
check(a[-1] == nil and a[8192] == nil)
```

### Done when

Scalar writes raise variable events; array writes are visible to JASS and vice versa.

---

## S6 — `jass.runtime`, error handling, sleep and RNG

**Commit:** `lua: jass.runtime settings, error handler and game RNG`

### Files

* new: `src/compat/lua/modules/runtime.ts`
* new: `src/compat/lua/errors.ts`
* edit: `src/compat/lua/host.ts` (reportError, wait interception, math.random)
* edit: `src/compat/lua/require.ts`

### Details

#### 1. Settings

```ts
interface RuntimeSettings {
  errorHandleRef: number;   // LUA_NOREF
  handleLevel: 0 | 1 | 2;
  console: boolean;
  sleep: boolean;
  catchCrash: boolean;
}
```

`__index` / `__newindex` implement `version = 3`, `error_handle`, `handle_level`, `console`,
`sleep`, `catch_crash`, `can_sleep`, and the `perftrace()` function. `perftrace` may return an
empty/zero string in the first commit; it must exist and reset.

#### 2. Error handler

`reportError(msg)`:

```
if reportError is already running: log and return
ref = settings.errorHandleRef
if ref == LUA_NOREF: log and return
lua_rawgeti(L, REGISTRY, ref)
lua_pushstring(L, msg)
pcall(L, 1, 0)      -- guarded: a handler that throws is logged, never re-entered
```

Call sites: coroutine error in `runCoroutine`, an engine-closure JS exception, and a Lua
error surfaced by `callLua`. Compile errors keep throwing to the loader (the map opens with no
triggers), which is the existing behaviour.

The `debug` library: keep `traceback` and `getinfo`, remove `sethook`, `debug`, `getregistry`,
`setupvalue`. This is the one sandbox loosening the YD runtime script needs.

#### 3. Sleep

`SLEEPING = { TriggerSleepAction, TriggerSyncReady, TriggerWaitForSound, SyncSelections }`
(YD's list, `libs_common.cpp:106-121`).

In `pushEngineClosure(name)`:

```
if SLEEPING.has(name) && !settings.sleep:
    warnOnce(name, "runtime.sleep is off — call ignored")
    push the native's typed default (0 / 0.0 / false / "" / nil)
    return
```

When on, the existing interceptors yield. Default `sleep = true`; document the divergence.

#### 4. RNG

Replace, after the prologue:

```
math.random()      -> rt.random()
math.random(n)     -> 1 + floor(r * n)
math.random(a, b)  -> a + floor(r * (b - a + 1))
math.randomseed(n) -> rt.setRandomSeed(n)   (the same stream GetRandomSeed uses)
```

`Math.random`/`Date` are never used. Add a test that two Lua draws equal two interpreter
`GetRandomReal` draws from a freshly seeded runtime.

### Tests

```
local rt = require "jass.runtime"
check(rt.version == 3)
check(rt.handle_level == 2)
rt.error_handle = function(m) lastError = m end
pcall(function() error("boom") end)       -- or an engine error path
check(lastError ~= nil)
rt.sleep = false
check(rt.can_sleep == false or true)     -- top level vs thread; assert both
-- RNG parity
SetRandomSeed(123)
local a, b = math.random(), math.random()
SetRandomSeed(123)
check(a == GetRandomReal(0, 1))
```

### Done when

Settings round-trip, the handler fires once per error, `sleep=false` makes the four functions
warned no-ops, and Lua randomness is the game's.

---

## S7 — `jass.debug` (and the two `Runtime` additions)

**Commit:** `lua: jass.debug introspection`

### Files

* new: `src/compat/lua/modules/debug.ts`
* edit: `src/jass/runtime.ts` (`nativeParams`, handle counters)
* edit: `src/jass/interpreter.ts` (`Interpreter.load` fills `nativeParams`)
* edit: `src/compat/lua/require.ts`

### Details

1. `Runtime.nativeParams: Map<string, string[]>`; in `Interpreter.load`:

```ts
for (const n of prog.natives) {
  this.rt.nativeReturns.set(n.name, n.returns);
  this.rt.nativeParams.set(n.name, n.params.map((p) => p.type));
}
```

2. `HandleTable`: add `maxId()` (the next id minus one) and `liveCount()` (table size). They
   are diagnostics only.

3. `functiondef(fn)`:
   * `const f = lua_tocfunction(L, 1)`;
   * name = `WeakMap<Function,string>` lookup populated by `engineClosure`;
   * if no name → `nil` (a map Lua function is not an engine function; YD answers nil too);
   * params = `rt.nativeParams.get(name)`, returns = `rt.nativeReturns.get(name)`;
   * push a table: `[1] = returnChar`, `[2..] = paramChars`.
   * Type chars are the engine's own enum (`func_value.h`): `I R B S C H V`.

4. `globaldef(name)`:
   * scalar: `rt.globalTypes.get(name)` → char, no `[]`;
   * array: `rt.globalArrays.get(name).elemType` → char + `"[]"`;
   * unknown → `nil`.

5. `handledef(h)`: `{ reference = 1, type = ty }`. Unknown handle → `nil`. `h2i`/`i2h` use
   the codec; `handle_ref`/`handle_unref` return their argument; `gchash` is a no-op;
   `currentpos` returns `nil` until the interpreter exposes its frame name.

### Tests

```
local d = require "jass.debug"
check(d.h2i(d.i2h(u)) == GetHandleId(u))
check(d.globaldef("bj_MAX_PLAYERS") == "I")
check(d.globaldef("udg_TestArray") == "I[]")     -- array flag
local sig = d.functiondef(nativeClosure)
check(sig[1] == "H")                              -- e.g. a handle-returning native
```

### Done when

A native's signature is answerable; a script global's declared type is answerable; ids round-trip.

---

## S8 — `jass.hook`

**Commit:** `lua: jass.hook over the native table`

### Files

* new: `src/compat/lua/modules/hook.ts`
* edit: `src/compat/lua/require.ts`
* edit: `src/compat/lua/host.ts` (`dispose` restores hooks)

### Details

State: `Map<string, { original?: NativeFn; callbackRef: number }>`.

Install:

```ts
const original = rt.natives.get(name);
const wrapper: NativeFn = (ctx, args) => {
  // push the callback, then its args, then a `real` closure
  const real = (realArgs: JassValue[]): JassValue =>
    original ? original(ctx, realArgs)
             : defaultForType(rt.nativeReturns.get(name) ?? "nothing");
  return callLuaCallback(callbackRef, args, real);
};
rt.natives.set(name, wrapper);
```

* `real` is a `lua_pushjsfunction` closure over `ctx`/`original`; it is only meaningful during
  the callback.
* `callLuaCallback` runs the Lua function under `lua_pcall` on a fresh coroutine; a yield is
  refused with one warning (a native cannot yield through its JS return).
* Reading `hook[name]` answers the callback; assigning `nil` restores `original` (delete the
  entry when there was none).
* Only names the runtime knows (`rt.natives` or `rt.nativeReturns`) may be hooked; otherwise
  ignore, as YD does.
* `dispose` restores all wrappers, including after a failed load.

### Tests

```
local H = require "jass.hook"
local seen
H.GetUnitState = function(u, s, real)
  seen = s
  return real(u, s) + 1
end
check(GetUnitState(u, UNIT_STATE_LIFE) == originalLife + 1)
check(seen == UNIT_STATE_LIFE)
H.GetUnitState = nil
check(GetUnitState(u, UNIT_STATE_LIFE) == originalLife)
```

### Done when

A hook sees typed arguments, `real` reaches the original, restoring works, and a hook installed
by a failed map is gone after dispose.

---

## S9 — JAPI registry, signatures, `jass.japi`, `EXExecuteScript`

**Commit:** `lua: JAPI registry and jass.japi`

### Files

* new: `src/compat/lua/japi/decl.ts`
* new: `src/compat/lua/japi/signature.ts`
* new: `src/compat/lua/modules/japi.ts`
* edit: `src/jass/runtime.ts` (`japi` map)
* edit: `src/compat/lua/require.ts`

### Details

#### 1. Signature parser

Grammar:

```
signature := "(" type* ")" type
type      := "I" | "R" | "B" | "S" | "C" | "V" | "H" name ";"
```

`parseSignature("(Hunit;I)Hability;") → { params: ["unit", "integer"], returns: "ability" }`.
Map the single letters to our type names (`integer`, `real`, `boolean`, `string`, `code`,
`nothing`, and the handle name). A malformed declaration throws at module load — a unit test
calls `parseSignature` over the whole declaration table, so a typo cannot reach a match.

#### 2. Declaration table

`decl.ts`:

```ts
export interface JapiDecl { name: string; param: string; }
export const YD_JAPI: readonly JapiDecl[] = [
  { name: "EXGetUnitAbility", param: "(Hunit;I)Hability;" },
  // … one row per `japi_add` in yd_jass_api, grouped by source module with a comment
];
```

Write our own table from the design document's inventory; do not copy the `.j` headers.

#### 3. Runtime

```ts
readonly japi = new Map<string, { params: string[]; returns: string; impl?: NativeFn }>();
```

`registerJapi(rt, decl, impl?)`:
* fill `rt.japi`;
* `rt.nativeParams.set(name, params)`, `rt.nativeReturns.set(name, returns)`;
* if `impl`, `rt.natives.set(name, impl)` — one implementation for JASS and both Lua tables.

#### 4. `jass.japi`

`__index`:
* registered + implemented → cached engine closure;
* registered + not implemented → a stub closure that warns once and pushes the declared typed
  default;
* unknown → `nil`.
`__pairs` over the registry, sorted.

#### 5. `EXExecuteScript`

```
source = "return (" + expr + ")"
luaL_loadbuffer(..., "@EXExecuteScript")
pcall(0, 1)
on error → reportError, return null
on success → string/number/boolean → string; else null
```

Resolve `TRIGSTR_` before evaluating, using the runtime's trigger-string table.

### Tests

```
local J = require "jass.japi"
check(type(J.EXGetUnitAbility) == "function")
check(J.NOT_REGISTERED == nil)
check(EXGetUnitAbility ~= nil)                 -- also a JASS native
local d = require "jass.debug"
check(d.functiondef(EXGetUnitAbility)[1] == "H")
-- unimplemented registered name
check(type(J.SOME_DECLARED_ONLY) == "function")
check(J.SOME_DECLARED_ONLY() == 0)             -- typed default, one warning
-- EXExecuteScript
check(EXExecuteScript("1+2") == "3")
```

### Done when

Every declaration parses; both tables reach the same implementation; a stub name is honest;
unknown names are nil.

---

## S10 — `exec-lua:` and the console/log modules

**Commit:** `lua: exec-lua entry point and console/log modules`

### Files

* new: `src/compat/lua/modules/console.ts`
* new: `src/compat/lua/modules/log.ts`
* edit: `src/compat/lua/host.ts` (wrap `Cheat`)
* edit: `src/compat/lua/require.ts`

### Details

1. Wrap `Cheat` while the host exists:

```ts
const original = rt.natives.get("Cheat");
rt.natives.set("Cheat", (ctx, args) => {
  const text = asStr(args[0] ?? JNULL);
  if (text.startsWith("exec-lua:")) {
    const name = text.slice(9).trim().replace(/^"(.*)"$/, "$1");
    host.requireModule(name);
    return JNULL;
  }
  return original ? original(ctx, args) : JNULL;
});
```

Restore in `dispose`. Not single-player-gated (design §13 row 12).

2. `jass.console`: `enable` get/set; `write(...)` joins values with tabs and calls
   `options.log("info", text)`; `read(fn)` exists and never fires.
3. `jass.log`: `path` (stored, no filesystem), `level` (stored, filters), and
   `trace/debug/info/warn/error/fatal`. Format `timestamp [level]: args`. Do not reproduce
   YD's `level` getter bug.

### Tests

```
Cheat("exec-lua:main")            -- runs the require, no engine cheat
local log = require "jass.log"
log.level = "warn"
log.info("hidden")                 -- not emitted
log.error("shown")                 -- emitted
```

### Done when

`exec-lua:` loads a module from the fake archive and non-prefixed cheats still reach the
engine.

---

## S11 — JAPI pack A, step 1: damage

**Commit:** `japi: EXGetEventDamageData / EXSetEventDamage`

### Files

* edit: `src/sim/world.ts` (`DamageBlow` fields + raise sites)
* edit: `src/jass/interpreter.ts` (`fireDamagePhase` structural type)
* edit: `src/jass/runtime.ts` (`damageStack` structural type)
* new: `src/compat/lua/japi/damage.ts`
* edit: `src/compat/lua/japi/decl.ts`

### Details

The existing blow carries `amount`, `attackType`, `damageType`, `weaponSound`. The four YD
questions it cannot answer yet are whether the blow is an attack, whether it is ranged,
whether it is physical, and the weapon-type index. Extend `DamageBlow` with optional fields
and fill them where the sim raises the blow (the two attack sites and the spell site):

```ts
export interface DamageBlow {
  // …existing…
  isAttack?: boolean;     // raised by a weapon swing
  isRanged?: boolean;     // that swing's weaponType is missile/instant
  physical?: boolean;     // the attack type is not DAMAGE_TYPE_* (spell) — the engine's own split
  weaponType?: number;    // the weaponType enum index, when known
}
```

`EXGetEventDamageData(type)` answers from the top `damageStack` entry:
0 → 1 (valid), 1 → `physical`, 2 → `isAttack`, 3 → `isRanged`, 4 → `damageType`,
5 → `weaponType`, 6 → attack-type index (reuse `ATTACK_TYPES.indexOf` from
`natives/events.ts`).

`EXSetEventDamage(r)` mirrors `BlzSetEventDamage`: set `blow.amount`, return true when a blow
is present, false otherwise.

### Tests

Headless: fire a damage phase with a synthetic blow, call both through `jass.japi` and through
JASS, and check the seven values; set the amount and read it back via `GetEventDamage`.

### Done when

Both dialects see the same values; `EXSetEventDamage` changes the blow the sim observes.

---

## S12 — JAPI pack A, step 2: item data

**Commit:** `japi: EXGetItemDataString / EXSetItemDataString`

### Files

* new: `src/compat/lua/japi/item.ts`
* edit: `src/jass/runtime.ts` (`EngineHooks` item-type read/write, optional)
* edit: `src/game/jassHooks.ts` (implement the hooks over the item registry)
* edit: `src/compat/lua/japi/decl.ts`

### Details

Type ids from `YDWEState.j`: `1 = Art`, `3 = Ubertip`, `4 = Name` (the C++ also touches
Tip/Description internally; keep to the three documented ids).

* Read: `hooks.itemTypeString?(typeId, id)`; map 1 → `ItemDef.icon`, 3 →
  `ItemDef.description` (Ubertip), 4 → `ItemDef.name`.
* Write: only if a per-type override layer exists. Until then return `false` and warn once.
  Do **not** mutate the shared registry row — two matches share it.

### Tests

```
local J = require "jass.japi"
check(J.EXGetItemDataString('ratc', 4) == "Claws of Attack +3")
check(J.EXSetItemDataString('ratc', 4, "X") == false)   -- until the overlay exists
```

### Done when

The three documented ids answer; a write never corrupts the shared row.

---

## S13 — JAPI pack A, step 3: ability instance and data

**Commit:** `japi: EX ability instance and data accessors`

### Files

* new: `src/compat/lua/japi/ability.ts`
* edit: `src/compat/lua/japi/decl.ts`

### Details

Reuse the 1.31 implementation:

* handles: `BlzGetUnitAbility` / `BlzGetUnitAbilityByIndex` (the same interned
  `AbilityInstanceRef` handles).
* field reads/writes: `rt.hooks.abilityField` / `setAbilityField` with the metadata ids already
  used by `Blz*Ability*Field`.

Data-type map (from `YDWEAbilityState.j`, which documents every number):

| YD id | meaning | OpenWar3 |
|---|---|---|
| 100 | TARGS | target flags mask — answer only if the row's raw mask is available, else typed default |
| 101 | CAST | `castTime` |
| 102 | DUR | `duration` |
| 103 | HERODUR | `heroDuration` |
| 104 | COST | `cost` (int) |
| 105 | COOL | `cooldown` |
| 106 | AREA | `area` |
| 107 | RNG | `castRange` |
| 108–116 | DATA_A..I | `data[0..8]` |
| 117 | UNITID | `summon` as a rawcode integer |
| 200 | HOTKET | the hotkey's char code (best effort from the string) |
| 201 | UNHOTKET | `unHotkey` |
| 202 | RESEARCH_HOTKEY | `researchHotkey` |
| 203 | NAME | `name` |
| 204 | ART | `icon` |
| 205 | TARGET_ART | `targetArt` |
| 206 | CASTER_ART | `casterArt` |
| 207 | EFFECT_ART | `effectArt` |
| 208 | AREAEFFECT_ART | the area-effect field if present, else typed default |
| 209 | MISSILE_ART | `missileArt` |
| 210 | SPECIAL_ART | `specialArt` |
| 211 | LIGHTNING_EFFECT | the lightning field if present, else typed default |
| 212/213 | BUFF_TIP / BUFF_UBERTIP | typed default until a buff-string layer exists |
| 214/217 | RESEARCH_TIP / RESEARCH_UBERTIP | `researchTip` / `researchUberTip` |
| 215/218 | TIP / UBERTIP | `tips[level-1]` / `uberTips[level-1]` |
| 216/219 | UNTIP / UNUBERTIP | `unTip` / `unUberTip` |
| 220 | UNART | `unIcon` |

Writes: route through the same per-instance layer as `BlzSetAbility*Field`. Strings/tips that
have no per-instance layer answer `false` until one exists.

`EXGetAbilityState(…, 1)` = cooldown (the only documented state).

### Tests

```
local a = J.EXGetUnitAbility(u, 'AHhb')
check(J.EXGetAbilityId(a) == 'AHhb')
check(J.EXGetAbilityDataReal(a, 1, 105) > 0)        -- Cool1
check(J.EXGetAbilityDataString(a, 1, 215) ~= "")
J.EXSetAbilityDataReal(a, 1, 107, 900.0)
check(J.EXGetAbilityDataReal(a, 1, 107) == 900.0)
```

### Done when

Every documented row answers a value of the right type; a write that lands is visible on the
same instance and not on another unit's copy.

---

## S14 — JAPI pack A, step 4: unit state and helpers

**Commit:** `japi: EX unit state, pause, facing and type data`

### Files

* new: `src/compat/lua/japi/unit.ts`
* edit: `src/jass/runtime.ts` (`EngineHooks.getUnitExtendedState/setUnitExtendedState`,
  `getUnitTypeDataSlot/setUnitTypeDataSlot`, optional)
* edit: `src/game/jassHooks.ts`
* edit: `src/compat/lua/japi/decl.ts`

### Details

#### 1. Instance state (`GetUnitState` / `SetUnitState` extensions)

Wrap the two natives while the host exists (the same technique as `jass.hook`):

```
if index in YD_EXTENDED (0x10..0x64):
    value = hooks.getUnitExtendedState(simId, index)
    undefined -> typed default (0.0) + warnOnce("GetUnitState:"+index)
else: original(ctx, args)
```

The engine side maps the YD indices to live state. Start with the rows the sim already knows:
attack-1/2 dice/sides/base/bonus/range/interval/backswing/target types/attack type/weapon
type, armour, armour type, rate of fire, acquisition range, min range, life/mana regen. Rows
with no engine field (spill radius, damage-loss factor) are deliberately left undefined.

#### 2. Helpers

| function | implementation |
|---|---|
| `EXPauseUnit(u, flag)` | `hooks.pauseUnit?(simId, flag)` over the sim's stun state |
| `EXSetUnitFacing(u, deg)` | `SetUnitFacing` behaviour (the existing native/hook) |
| `EXSetUnitMoveType(u, type)` | `hooks.setUnitMoveType?(simId, type)`; partial |
| `EXSetUnitCollisionType(enable, u, type)` | `hooks.setUnitCollisionType?`; the move bit maps to `noCollision`; other bits later |
| `EXGetObject(u)` | `0` + one warning |

#### 3. Type data (raw slots)

`EXGet/SetUnit{Integer,Real,String,ArrayString}` route to
`hooks.getUnitTypeDataSlot?(typeId, slot)` / `setUnitTypeDataSlot?`. Implement only the
proven slots in the engine: **10 = Name array** and **61 = Proper Names array**, where the
integer slot is the array count. Any other index returns the typed default and logs the index
once (the S0 report + this log is the evidence for a later table).

### Tests

```
check(GetUnitState(u, 0x20) == armor)          -- armour
check(GetUnitState(u, 0x16) > 0)               -- attack-1 range
EXPauseUnit(u, true)                                   -- the sim's stun path; assert at sim level
EXSetUnitFacing(u, 90.0); check(GetUnitFacing(u) == 90.0)
EXSetUnitArrayString('hfoo', 10, 0, "Footman!")
check(EXGetUnitArrayString('hfoo', 10, 0) == "Footman!")
EXSetUnitInteger('hfoo', 10, 1)
```

### Done when

The pack A names in §6.7 of the design document all answer; unknown indices are honest and
logged; plain JASS maps can call the same names.

---

## S15 — `jass.selector`

**Commit:** `lua: jass.selector`

### Files

* new: `src/compat/lua/modules/selector.ts`
* edit: `src/compat/lua/require.ts`

### Details

`hero()` returns an array of unit handles for the map's heroes. Iterate `rt.units`, skip
`removed`, and ask `IsUnitType(u, UNIT_TYPE_HERO)` through `interp.callFunction` (the constant
is read from `rt.globals` at call time). Push a 1-based Lua array.

### Tests

Spawn two heroes and a Footman; `#heroes == 2`; the values are the hero handles.

---

## S16 — `jass.code`

**Commit:** `lua: jass.code and the script-function hook seam`

### Files

* new: `src/compat/lua/modules/code.ts`
* edit: `src/jass/runtime.ts` (`codeHooks`)
* edit: `src/jass/interpreter.ts` (two call sites)
* edit: `src/compat/lua/require.ts`

### Details

1. `rt.codeHooks: Map<string, (ctx, args, real) => JassValue>` (optional).
2. In `callFunction` and `callFunctionG`, after natives/host functions and **before**
   `rt.functions`:
   * if a hook exists, run it; `real` calls the original `FunctionDecl` exactly as the current
     path would.
3. `jass.code[name]` returns a callable that calls `interp.callFunction(name, args)`.
   `pairs` enumerates `rt.functions` + `rt.hostFunctions` sorted.
4. Assigning a function installs a hook; assigning nil removes it. The callback runs
   synchronously; a wait is refused.
5. Hooks are restored by `dispose`.

### Tests

Hook a map function, call it from JASS, assert the Lua wrapper saw it and `real()` returned
the original; remove and re-assert.

---

## S17 — `jass.slk`

**Commit:** `lua: jass.slk raw table access`

### Files

* new: `src/compat/lua/modules/slk.ts`
* edit: `src/compat/lua/require.ts`

### Details

* Lazy `MappedData` per file family, read from `options.install.rawBytes`.
* Tables: `ability`, `buff`, `unit`, `item`, `upgrade`, `doodad`, `destructable`, `misc`.
* Each is an object-id indexed proxy; a row is a column-name indexed proxy; values are
  strings (`SlkValue::to_string`).
* `__pairs` and `factory` return the row iterator.
* `misc` reads `MiscData` and, for `Misc`, `miscGame()` through the edition/patch chain — not
  the raw file (CLAUDE.md: gameplay constants live in one place).
* File lists follow `docs/wc3-data-formats.md`; column lookups are case-insensitive.

### Tests

```
local slk = require "jass.slk"
check(slk.unit['hfoo'].HP == "420")                -- Footman
check(type(slk.unit['hfoo'].HP) == "string")
check(slk.ability['AHhb'].Cool1 ~= nil)
check(slk.misc.Misc.DefenseArmor ~= nil)
```

### Done when

Rows and columns match the install's own files; unknown ids/columns are nil.

---

## S18 — `jass.message` over an injected input bridge

**Commit:** `lua: jass.message input bridge`

### Files

* new: `src/compat/lua/modules/message.ts`
* new: `src/compat/lua/input.ts` (`LuaInputBridge` + `LuaInputEvent`)
* edit: `src/compat/lua/require.ts`
* edit: `src/jass/index.ts` (pass `input`)
* edit: `src/render/mapViewer.ts` / `src/game/rts.ts` (implement the bridge)

### Details

```ts
export interface LuaInputEvent {
  type: "key_down" | "key_up" | "mouse_down" | "mouse_up" | "mouse_ability";
  code?: number; x?: number; y?: number; ability?: number; order?: number;
}
export interface LuaInputBridge {
  setFilter(fn: ((ev: LuaInputEvent) => boolean) | null): void;
  mouseWorld(): { x: number; y: number };
  commandButton(x: number, y: number): { ability: number; order: number; targetType: number } | null;
  selectedUnit(): number;
  issueOrder(kind: "immediate" | "point" | "target", order: number, x?: number, y?: number, target?: number, flags?: number): boolean;
}
```

* `hook` installs/removes the filter; returning false swallows the event.
* `mouse()` reads the world point under the cursor.
* `button(x,y)` reads the command card's model.
* `selection()` reads the local selection.
* `order_*` go through `RtsController.execute` (never around it).
* `keyboard` is a generated table of VK codes.

This is the only renderer-coupled step. The compat layer sees only the interface.

### Tests

Headless with a fake bridge: `hook` receives a synthetic key event; `mouse` returns the
bridge's point; `order_point` calls the fake and returns true. In-browser: a manual pass with
`?dev`.

---

## S19 — Stubs, dispose hardening, docs and performance

**Commit:** `lua: stubs, disposal and the last compatibility pass`

### Files

* new: `src/compat/lua/modules/stubs.ts`
* edit: `src/compat/lua/host.ts` (`dispose`)
* edit: `docs/lua-engine-port.md` (status section)
* edit: `CLAUDE.md` (one bullet, once shipped)

### Details

1. `jass.bignum`, `jass.debugger`, `jass.ai`: empty modules whose names answer `nil` and log
   once on first access. `jass.storm`: `load(name)` over the map archive, `save` = false.
2. `dispose()` must, in this order:
   * restore every `jass.hook` wrapper and the `Cheat` wrapper;
   * restore the wrapped `GetUnitState`/`SetUnitState`;
   * remove every `runtime.hostFunctions` entry this host published;
   * unref every registry ref (closures, error handler, callback table);
   * clear handle intern tables;
   * drop the module cache so a reload starts clean.
3. Performance: count engine calls per second in a dev run; if module `__index` shows up,
   increase closure caching (never cache values/globals). Do not add a second lookup table
   before measuring.
4. Update the design document's "Status" paragraph and add the `CLAUDE.md` bullet with the
   same shape as the other subsystem bullets.

### Tests

`dispose` twice is safe; after dispose, the next `createLuaMapScript` starts with no hooks
and no host functions; a map reload in the same page works.

---

## Appendix A — Test matrix

| area | assertion | step |
|---|---|---|
| bridge | handle identity, int/real distinction, `code` round trip | S1 |
| options | host accepts map/install sources | S2 |
| require | preload, map module, missing, traversal | S3 |
| common | natives, constants, live globals, write-through, pairs | S4 |
| globals | scalar write event, array view, defaults, bounds | S5 |
| runtime | version, handle_level, error_handle, sleep, can_sleep | S6 |
| RNG | Lua draws == interpreter draws after a shared seed | S6 |
| debug | h2i/i2h, globaldef, functiondef | S7 |
| hook | typed args, real(), restore | S8 |
| JAPI | declarations parse, both tables, stub default, unknown nil, EXExecuteScript | S9 |
| entry | exec-lua, non-prefixed cheat still works | S10 |
| damage | seven types, set amount | S11 |
| item | three string ids, refused write | S12 |
| ability | id/level/state, data table, per-instance write | S13 |
| unit | extended state, pause, facing, slots 10/61 | S14 |
| selector | hero list | S15 |
| code | hook + real + restore | S16 |
| slk | row/column values | S17 |
| message | filter, mouse, order | S18 |
| dispose | idempotent, no residue | S19 |

## Appendix B — Commit checklist

```
S1  lua: split host values/handles and expose a module facade
S2  lua: thread map/install/input options into the Lua host
S3  lua: add require/package with a map-archive searcher
S4  lua: jass.common proxy over natives and globals
S5  lua: live JASS globals and array proxies
S6  lua: jass.runtime settings, error handler and game RNG
S7  lua: jass.debug introspection
S8  lua: jass.hook over the native table
S9  lua: JAPI registry and jass.japi
S10 lua: exec-lua entry point and console/log modules
S11 japi: EXGetEventDamageData / EXSetEventDamage
S12 japi: EXGetItemDataString / EXSetItemDataString
S13 japi: EX ability instance and data accessors
S14 japi: EX unit state, pause, facing and type data
S15 lua: jass.selector
S16 lua: jass.code and the script-function hook seam
S17 lua: jass.slk raw table access
S18 lua: jass.message input bridge
S19 lua: stubs, disposal and the last compatibility pass
```

## Appendix C — Stop conditions

Stop and amend the design document if any of these happens:

1. fengari cannot represent a full userdata handle the way S1 needs (mode 2 becomes a
   documented approximation, not a silent change).
2. `lua_tocfunction` does not return the JS function pushed by `lua_pushjsfunction`
   (`debug.functiondef` needs the registry-table fallback).
3. The sim cannot supply `isAttack` / `isRanged` at a blow site without changing combat
   behaviour — then pack A answers those two conservatively and the design document says so.
4. A required JAPI function turns out to need a `CUnitData` slot whose table we do not have —
   it stays declared-not-answered, and the index is added to the open questions.
5. `jass.message` cannot be wired without giving the compat layer a renderer import — then
   the bridge interface is widened, never the import rule.
