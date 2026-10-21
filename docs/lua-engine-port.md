# `yd_lua_engine` → OpenWar3 — porting the Lua engine contract

**Status: plan.** Nothing in this document is implemented yet. It is the analysis of
`KKWE3/Development/Plugin/Warcraft3/yd_lua_engine` (YDWE's Lua plugin, 4 700 lines of C++)
and the technical plan for making OpenWar3 answer the same Lua API.

The source is a **native DLL injected into `War3.exe`**. It cannot be shipped or executed
here, and it must not be: every one of its interesting mechanisms is a process-level trick
(memory offsets into `Game.dll`, a patched Lua allocator, x86 trampolines, a Windows debug
console, RSA-signed DLL loading). What we port is the **contract** — the module names, the
table shapes, the value conversions, the hook protocol and the sleep protocol — onto the
`Runtime` we already have. See `docs/map-compatibility.md` §6 for the existing Lua front end.

Sources read for this plan (paths are relative to the KKWE3 repo):

| file | what it establishes |
|---|---|
| `lua_engine/open_lua_engine.cpp` | the 15 `jass.*` preload modules, the four metatables |
| `lua_engine/lua_loader.cpp` | one state per game session; `exec-lua:`; `EXExecuteScript` |
| `lua_engine/common.cpp` | typed call into JASS, the yield protocol, `code` conversion |
| `lua_engine/jassbind.cpp` | every Lua↔JASS value conversion |
| `lua_engine/callback.cpp` | `safe_call`, coroutine sleep, trampolines to `code` |
| `lua_engine/class_real.cpp` | precise `real` userdata and its arithmetic |
| `lua_engine/class_handle.cpp` | the three handle levels |
| `lua_engine/class_array.cpp` | live JASS-array proxy |
| `lua_engine/libs_common.cpp`, `libs_globals.cpp` | the proxy-table pattern |
| `lua_engine/libs_runtime.cpp` | `version/handle_level/sleep/catch_crash/error_handle` |
| `lua_engine/libs_hook.cpp` | native hooking and the `real` closure |
| `lua_engine/libs_debug.cpp` | `h2i`, `i2h`, `functiondef`, `globaldef`, `handledef` |
| `lua_engine/libs_selector.cpp`, `libs_code.cpp`, `libs_slk.cpp` | hero list, code hooks, raw SLK |
| `lua_engine/libs_message.cpp` | input filter, command-card slots, order injection |
| `lua_engine/fix_baselib.cpp` | RNG wiring, sandbox trimming, file access |
| `lua_engine/libs_package.cpp` | Storm / file / (signed) DLL searchers |
| `lua_engine/libs_console.cpp`, `libs_log.cpp`, `libs_storm.cpp` | debug console, file log, io shim |
| `lua_engine/libs_bignum.cpp`, `sha_1.*` | RSA verification for DLL loading (not ported) |

---

## 1. How the original works

### 1.1 State lifecycle

`lua_loader.cpp:46-55` creates **one** `lua_State` per game session:

```
luaL_newstate2()          // a patched Lua 5.3 whose global-State seed is taken from the
                          // game's own SetRandomSeed value (lua_helper.cpp:35-51;
                          // `g->seed = seed` in OpenSource/Lua/lstate.c:356)
luaL_openlibs(L)
clear_searchers_table(L)  // drop the disk searchers
open_lua_engine(L)        // preload jass.* and install the metatables
runtime::initialize()
```

It is closed on the game-reset event (`lua_loader.cpp:27-34`). The seed matters: YD's Lua
is **lockstep**, and every random number a map draws must be identical on every client.

### 1.2 The module surface

`open_lua_engine.cpp:39-69` registers 15 preload entries plus a deprecated one:

`jass.common`, `jass.globals`, `jass.japi`, `jass.hook`, `jass.runtime`, `jass.slk`,
`jass.console`, `jass.debug`, `jass.message`, `jass.bignum`, `jass.log`, `jass.ai`,
`jass.debugger`, `jass.selector`, `jass.code`, (`jass.storm`).

Almost all of them are the **same shape**: a table whose metatable answers `__index` /
`__newindex` (and `__pairs`) by reaching into the live engine. `libs_common.cpp:116-142`,
`libs_globals.cpp:142-163`, `libs_japi.cpp:49-70`, `libs_runtime.cpp:317-338`,
`libs_hook.cpp:286-304`. There is no exported object graph; the table is a window.

### 1.3 The value bridge

| Lua | JASS | where |
|---|---|---|
| boolean | boolean | `jassbind::read_boolean` |
| integer / number | integer (masked to 32 bits) / real | `jassbind::read_integer`, `read_real` |
| string | string (a trigger-string is resolved on push) | `read_string`, `push_string` |
| function | `code` — via a generated JASS trampoline | `read_code` → `cfunction_to_code` |
| userdata / light userdata / number | `handle` | `class_handle.cpp:163-202` |
| nil | null | everywhere |

`code` is the expensive one: `callback.cpp:228-250` builds a JASS trampoline that calls back
into Lua, and the Lua function is kept alive in a registry table (`libs_runtime.cpp:140-182`).

Handles have **three modes**, set by `runtime.handle_level` (`libs_runtime.cpp:10`,
`class_handle.cpp:167-201`): `0` raw number, `1` light userdata, `2` userdata with a
`__gc` that decrements the engine's handle refcount. The default is **2**; the shipped
example sets 2 explicitly (`example/JAPI/lua/runtime_init.lua`).

Reals have a second, optional representation: `class_real.cpp` boxes a float in a userdata
so that arithmetic between two JASS reals stays in **single precision**; mixing with a Lua
number returns a double.

### 1.4 Sleep and threads

For a Lua **callback** to be able to wait, YD runs every native call inside a Lua coroutine
when `runtime.sleep` is true (`callback.cpp:101-153`). `TriggerSleepAction` and its three
siblings are marked `has_sleep` at load (`libs_common.cpp:106-121`); the C++ call yields,
the coroutine is parked per (Lua thread, JASS thread) pair (`libs_runtime.cpp:76-133`), and
the engine resumes it later. A call from a context that cannot yield is refused with a
warning (`common.cpp:114-119`).

### 1.5 Hooks

`jass.hook[name] = fn` patches the native in the JASS function table; the callback receives
the native's arguments **plus a trailing `real` closure** that calls the original
(`libs_hook.cpp:135-161`, `223-260`). `jass.code[name] = fn` does the same to a script
function (`libs_code.cpp:103-234`).

### 1.6 Entry points

* `war3map.lua` is not what this engine is for — it predates Blizzard's Lua. YD maps run
  Lua through the **`exec-lua:` cheat** (`lua_loader.cpp:75-90`), which `require`s a module
  by name, or through the exported plugin API.
* `EXExecuteScript("expr")` is registered as a JAPI native and evaluates
  `return (expr)` in the same state (`lua_loader.cpp:93-117`).

### 1.7 What is process-specific (and therefore not portable)

`Game.dll` offsets and hashtable walks; the JASS VM's function/global tables; Storm
archive handles; a Win32 console window; an HWND-level message filter; `LoadLibrary` of
RSA-signed DLLs; `GetCursorPos`; x86 trampolines. None of these are "the Lua support" — they
are how a DLL reads a 2003 process. OpenWar3 replaces each with a `Runtime` call.

---

## 2. What OpenWar3 already has

`src/compat/lua/host.ts` is a **Lua front end over the running JASS runtime**:

* one fengari state (Lua 5.3 — the same version YD embeds: `OpenSource/Lua/lua.h`);
* `_G` resolves unknown names into `rt.globals`, then `rt.natives`/`rt.functions`
  (`host.ts:314-356`) — the official 1.31 map dialect;
* a handle is interned light userdata (`host.ts:105-111`);
* a Lua function handed to the engine becomes a named `Runtime.hostFunctions` entry
  (`host.ts:173-195`);
* a wait is a coroutine yield (`host.ts:211-244`);
* `__jarray` and `FourCC` in the prologue (`host.ts:398-410`);
* a closed sandbox — `io`, `os`, `package`, `require`, `dofile`, `loadfile`, `load`,
  `loadstring`, `collectgarbage`, `debug` are all removed (`host.ts:81`, `402-410`).

`tools/jass-lua-test.cjs` proves the bridge against the install's own `common.j` and
`blizzard.j`.

### The gaps this port fills

1. **No modules.** `require` is gone, so `require "jass.common"` and `require "blizzard"`
   cannot work. That is the *entire* entry point of a YD map.
2. **No `jass.runtime`.** The four sleeping natives are always live (a YD default is off);
   there is no `error_handle`, `handle_level`, `catch_crash` or `perftrace`.
3. **No `jass.globals`.** Live array proxies and the `pairs` view do not exist.
4. **No hooks.** `jass.hook` / `jass.code` have no equivalent.
5. **No `jass.debug`.** No `h2i`/`i2h`/`functiondef`/`globaldef`.
6. **No `jass.japi`**, so `EXExecuteScript` and any map/plugin native have nowhere to live;
   `Cheat("exec-lua:…")` does nothing special. This has two halves — the registry facade and
   the JAPI *functions* behind it — and §6 separates them.
7. **No `debug` library** — but the YD runtime script calls `debug.traceback()` in its own
   `error_handle`; removing it breaks the shipped convention.
8. **No archive-backed `require`**, so a map's own `blizzard.lua` / `lib/*.lua` cannot load.
9. **Lua RNG is independent of the game's RNG.** YD maps `math.random` to `GetRandomReal`
   (`fix_baselib.cpp:19-55`); ours seeds fengari separately, so a map that mixes game and
   Lua randomness desynchronises from the game's own stream.
10. **Null handles.** A JASS null is `nil` in YD (`class_handle.cpp:42-45`); our bridge
    boxes handle id 0.

---

## 3. Shape of the port

### 3.1 One state, module proxies, no second engine

Keep the existing state and the existing `_G` bridge. Add the modules as **lazy preloads**
in the same state, each a table whose metatable reaches into `Runtime`. This is the same
architecture as YD — a window, not an object graph — and it is why the port is an adapter
rather than a runtime.

```
map archive (MpqDataSource) ─┐
install DataSource (SLK)  ───┤
Runtime + Interpreter ───────┤
input/console bridges     ───┤
                             ▼
                 createLuaMapScript(interp, seed, opts)
                     │  _G bridge (existing)
                     │  package/require ── preload jass.* + map *.lua
                     │  modules (metatable proxies)
                     ▼
                    fengari state
```

Nothing outside `src/compat/lua/` learns that a module exists. The two app-side bridges
(input and console) are **interfaces injected by the caller**, because the compatibility
layer may not import the renderer (`src/compat/README.md` contract).

### 3.2 File map

```
src/compat/lua/
  host.ts            extended: options, require install, error handler, dispose
  require.ts         package table, preload, map-archive searcher, path guards
  values.ts          the Lua↔JASS conversions shared by every module (moved out of host)
  handles.ts         handle boxing per handle_level, __eq/__tostring, null → nil
  jarray.ts          live JASS-array proxy (read/write/len)
  errors.ts          error_handle plumbing + traceback (one-warning policy)
  modules/
    common.ts        jass.common
    globals.ts       jass.globals
    runtime.ts       jass.runtime
    debug.ts         jass.debug
    hook.ts          jass.hook
    japi.ts          jass.japi (registry + EXExecuteScript)
    selector.ts      jass.selector
    code.ts          jass.code
    slk.ts           jass.slk
    message.ts       jass.message (over an injected bridge)
    console.ts       jass.console
    log.ts           jass.log
    stubs.ts         jass.bignum / debugger / ai / storm
```

`host.ts` stays the only file that owns the state. Modules receive a small `LuaHost` facade
(`push`, `read`, `nameForFunction`, `runCoroutine`, `rt`, `interp`) rather than reaching
into the state directly.

### 3.3 API changes

```ts
// src/compat/lua/host.ts
export interface LuaHostOptions {
  /** The map archive, so `require` can read `*.lua` the map ships. */
  map?: { rawBytes(path: string): Uint8Array | null };
  /** The install, for `jass.slk` (read-only, root tables only). */
  install?: { rawBytes(path: string): Uint8Array | null };
  /** Injected by the app; the compat layer must not import the renderer. */
  input?: LuaInputBridge;
  /** Console sink; defaults to console.info. */
  log?: (level: string, text: string) => void;
  /** YD's `runtime.sleep` (see §8 for why the default flips). */
  sleep?: boolean;
}
export function createLuaMapScript(interp, seed, opts: LuaHostOptions = {}): LuaMapScript;

export interface LuaMapScript {
  load(source, chunkName): void;
  hasFunction(name): boolean;
  functionCount(): number;
  /** New: run a module the way `exec-lua:` does; returns its value. */
  require(name: string): JassValue;
  dispose(): void;   // also restores every hook and removes every host function
}
```

`src/jass/parseMapScript`'s caller (`src/jass/index.ts:136-143`) passes `{ map, install }`;
`loadMapScript` already receives both.

`Runtime` gains two small read-only surfaces used by `jass.debug` and the RNG wiring:

```ts
readonly nativeParams = new Map<string, string[]>();  // filled in Interpreter.load
random(): number;                                     // already exists (natives/index.ts)
nextThreadId / handle counts: methods on HandleTable  // for handlecount/handlemax
```

`Interpreter.load` already has `prog.natives`; keep `n.params.map(p => p.type)` beside
`nativeReturns`.

---

## 4. The value bridge

This is where most compatibility bugs live, so it is specified once and used by every
module.

### 4.1 Lua → JASS (`read`)

Match `jassbind.cpp` exactly:

| Lua type | JASS value |
|---|---|
| `nil` / none | `null` |
| boolean | `bool` |
| number, integer subtype | `int`, masked with `|0` |
| number, float subtype | `real` (double; see §4.4) |
| string | `string` (`lua_tostring` also accepts numbers — match it) |
| function | `code`: register as a host function and return its name |
| userdata / light userdata | `handle` (or raw int at level 0) |
| table | `null` + one warning per call site (YD's readers each fall back to a type default; we say so instead of inventing one) |

Boolean conversion deserves the citation: YD is `nil → false`, boolean → itself, otherwise
`lua_tonumber != 0` (`jassbind.cpp:66-74`). A Lua string `"true"` is **false** in that rule.

### 4.2 JASS → Lua (`push`)

| JASS value | Lua value |
|---|---|
| `null` | `nil` |
| `int` | integer |
| `real` | number (single-precision rounding only if `f32` is enabled — §4.4) |
| `bool` | boolean |
| `string` | string |
| `handle` | per `handle_level`; **id ≤ 0 → `nil`** |
| `code` | a callable closure that invokes the named function, not a bare string |

The `code` change is worth doing now: pushing a name as a string means a round trip through
Lua (`local f = someHandler; TriggerAddAction(t, f)`) hands the engine a string, which the
native reads as `jstr` and rejects. YD pushes an integer trampoline; our honest equivalent
is a closure whose upvalue is the name, and whose `read` converts back to `{k:"code", fn}`.

### 4.3 Floats

YD's default (`jassbind.cpp:81-90`) converts reals to `float` on read and back to double on
push; `push_real_precise` keeps a userdata only for **event arguments** (`common.cpp:274`).
Our sim computes in doubles end to end. Applying float32 at the Lua boundary alone would
make Lua disagree with the sim, so:

* **default:** doubles (current behaviour, documented);
* optional `f32` mode rounds at both boundaries, for a map that depends on single-precision
  accumulation. Do not enable it globally without a corpus measurement.

### 4.4 Handle modes

`runtime.handle_level` is accepted at all three values:

| level | representation | status |
|---|---|---|
| 0 | integer id | implement (fast path for scripts that want numbers) |
| 1 | light userdata (interned box) | implement — current behaviour |
| 2 | userdata with `__eq`, `__tostring` | implement over the **same interned boxes** |

Level 2 is the YD default, but its `__gc` exists to decrement a native refcount we do not
have (the JS handle table owns handles already). We therefore present level 2 as userdata
with identity and a readable `tostring`, and make `__gc` a no-op. This is invisible to
every script except one that inspects `tostring`, and it is stated in the divergence table.

`h2i`/`i2h`/`GetHandleId` all agree on one id — the runtime's. Converted constants keep
their `index` exactly as `natives/index.ts` already does.

---

## 5. Modules, one by one

### 5.1 `require` / `package` (the entry point)

YD installs a preload searcher plus Storm and file searchers (`lua_helper.cpp:53-119`,
`libs_package.cpp:90-169`). Ours:

* `package.preload` holds every `jass.*` module (lazy).
* `package.path` defaults to `?.lua;lua/?.lua;scripts/?.lua`; scripts may extend it.
* The **only** file searcher reads the **map archive** (`opts.map.rawBytes`), never the
  install or the disk. A name `a.b` is tried as `a/b.lua`, `a\b.lua` and `a.b.lua`, in that
  order, case-insensitively (MPQ semantics).
* Paths containing `..`, a drive letter, a leading slash/backslash or a `:` are refused
  before the lookup. `package.cpath`, `package.loadlib` and the DLL searcher do not exist.
* `package.loaded` caches by the name the script asked for; a module returning `nil`
  caches `true` (Lua's rule).
* A miss raises a Lua error listing the tried paths — the same shape as Lua's own message.
* A shipped `blizzard.lua` in the map wins; if the map has none, we preload a **built-in
  `blizzard` module** that proxies `rt.functions` (the install's own `Scripts\blizzard.j`)
  so `require "blizzard"` is never a hard failure. This is a compatibility win over YD,
  which expects the map to ship a converted copy.

`require` is added to the state; the sandbox test in `tools/jass-lua-test.cjs` must change
from `require == nil` to "require exists and can reach nothing but `jass.*` + the map".

### 5.2 `jass.common`

`__index(key)`:

1. `rt.globals.get(key)` → live value (never cached — `bj_lastCreatedUnit` is rewritten on
   nearly every BJ call). Arrays → a live proxy (§5.3).
2. `rt.natives.has(key) || rt.nativeReturns.has(key)` → a closure that calls
   `interp.callFunction(key, args)` (resolution then finds natives, host functions, and the
   typed default for an unimplemented native).
3. otherwise `nil`.

`__newindex(key, v)` writes through to an existing JASS scalar global; arrays are ignored
(YD's `jass_set` does the same); unknown names are ignored rather than created.

`__pairs` yields native names and their closures.

**Caching.** YD never caches; a cached key would also swallow a later `CJ.X = v`, because
`__newindex` only fires for absent keys. Cache the *closure* in a JS `Map<string, ref>`
(`luaL_ref`) and push the ref — the metatable still sees every write, and hot loops do not
allocate a closure per access.

### 5.3 `jass.globals` and the array proxy

`__index` → `rt.globals` scalar, or `rt.globalArrays` proxy. `__newindex` → `assignGlobal`
(so `TriggerRegisterVariableEvent` fires); writes to an array proxy go through
`JassArray.set`. `__pairs` walks both maps.

The proxy (`jarray.ts`) is a table with:

* `__index` / `__newindex` reading and writing `JassArray` at the **raw 0-based** index;
* an out-of-range index reads `nil` and ignores the write (YD `jarray_index` /
  `jarray_newindex`; JASS's size is 8192);
* `__len` = 8192;
* the default comes from the array's own type, so `udg_A[i] + 1` works unwritten.

It must be a **view**, never a copy: a hasthable/trigger writes the array while Lua holds it.

### 5.4 `jass.runtime`

| member | behaviour |
|---|---|
| `version` | 3 |
| `error_handle` | get/set a Lua function; called with the message on every Lua error (compile, chunk, callback) |
| `handle_level` | 0/1/2, see §4.4; changes how *both* directions box handles from that point |
| `console` | toggles the console sink (§5.12); no Win32 window |
| `sleep` | see §8; **default true here**, false in YD — explained in §13 |
| `catch_crash` | stored; JS exceptions are already caught per native (`interpreter.ts:387-399`) |
| `can_sleep` | `sleep && lua_isyieldable(L)` |
| `perftrace()` | returns/reset a native-call/event timing string (`performance.now`) |

`error_handle` must be called with a broken stack in mind: invoke it under `pcall`; if it
throws, log that and continue — never recurse.

### 5.5 `jass.hook`

Install:

```
original = rt.natives.get(name)            // may be undefined for a declared-only native
rt.natives.set(name, (ctx, args) => callLua(cb, [...args, realClosure]))
```

* The callback receives the arguments **typed as Lua values** and a trailing `real`
  closure that invokes `original(ctx, argsFromLua)`. The `ctx` is captured per call, so
  nested calls are safe.
* Reading `hook[name]` returns the installed callback; assigning `nil` removes the wrapper
  and restores the original entry **by identity**, not by re-resolving the name.
* A hook callback runs synchronously. A wait inside it cannot yield through a native return
  and is refused with a warning (the same rule as a wait inside a JASS condition).
* Only names the runtime knows (implemented or declared in `common.j`) may be hooked;
  otherwise the assignment is ignored, as in YD (`libs_hook.cpp:227-241`).
* All hooks are restored by `dispose`, including on a failed map load.

### 5.6 `jass.japi`

In the original this is only a `__index` over the `japi_function` map (`libs_japi.cpp:21-37`);
the functions themselves are engine natives. Ours is the same shape:

* a `Map<string, JapiDecl>` on the host (`{ name, params, returns, fn? }`), with `__index` /
  `__pairs`;
* every entry is **also** registered in `rt.natives` (and `rt.nativeParams` /
  `rt.nativeReturns`), because `japi_add` adds the name to the JASS native table as well as
  to the JAPI map (`hook.cpp:352-356`). One implementation serves JASS and both Lua tables.
* a name in the registry but with no implementation answers its declared type's default and
  logs once — a partial JAPI must not crash a map on its first call;
* a name not in the registry answers `nil`, so a typo fails where it is written;
* `EXExecuteScript(expr)` is a built-in entry (§7.3), and `registerJapi(name, decl, fn)` is
  the door a future plugin surface would use. No JAPI plugin is ported as a whole — see §6.

### 5.7 `jass.debug`

| function | our answer |
|---|---|
| `functiondef(fn)` | name → `rt.nativeParams`/`nativeReturns` or `rt.functions` params; returns the type array YD builds (`libs_debug.cpp:10-29`) |
| `globaldef(name)` | `rt.globalTypes` / `rt.globalArrays.elemType` → type char (+ `[]`) |
| `handledef(h)` | `{ reference = 1, type = <jass type name> }`; `nil` for a non-handle |
| `h2i(h)` / `i2h(i)` | the runtime handle id, both directions |
| `handle_ref` / `handle_unref` | no-ops returning their argument (JS owns lifetime) |
| `handlemax` / `handlecount` | new `HandleTable` counters |
| `currentpos()` | `(functionName, 0)` if the interpreter exposes the current frame; otherwise `nil` |
| `gchash(x)` | no-op (a YD Lua-patch hook) |

Native param types require `Runtime.nativeParams` (§3.3). Type characters follow YD's
`variable_type` bytes: `i`, `r`, `b`, `s`, `h`, `c`.

### 5.8 `jass.selector`

`hero()` returns an array of unit handles: iterate `rt.units`, keep living units for which
`IsUnitType(u, UNIT_TYPE_HERO)` is true. Everything else (`IsVaildUnit`'s memory sniffing)
is subsumed by the runtime's own liveness. The constant is read from `rt.globals` at call
time, never hard-coded.

### 5.9 `jass.code`

* `code[name]` returns a callable that invokes the script function by name and returns its
  value (YD walks the JASS code table; we call `interp.callFunction`).
* `pairs` enumerates `rt.functions` + `rt.hostFunctions`.
* **Hooking** a script function needs one seam in the interpreter: a `rt.codeHooks` map
  consulted in `callFunction`/`callFunctionG` **after** natives and host functions and
  **before** `rt.functions`. The hook wrapper receives the call's arguments and a `real`
  closure, exactly like `jass.hook`.
* This is phase 3: it is used by tooling more than by maps, and the seam must not perturb
  call order for JASS maps (a hook exists only when a script installed one).

### 5.10 `jass.slk`

Read-only raw tables. YD exposes `ability`, `buff`, `unit`, `item`, `upgrade`, `doodad`,
`destructable`, `misc`, each an object-id index into an SLK row keyed by **column name**
(`libs_slk.cpp:240-256`).

Implementation:

* Load the raw files lazily with `MappedData` (already a dependency of `src/data/*`), from
  the **install** `DataSource`, not the map.
* File families follow `docs/wc3-data-formats.md`: `Units\UnitData.slk`, `UnitBalance.slk`,
  `UnitUI.slk`, `UnitWeapons.slk`, the per-race `*Func.txt`, the `*Strings.txt`;
  `Units\AbilityData.slk` + `AbilityFunc.txt`; `Units\ItemData.slk` + `ItemFunc.txt`;
  `Units\UpgradeData.slk` + `UpgradeFunc.txt`; `Units\DestructableData.slk` +
  `DestructableFunc.txt`; `Units\DoodadData.slk`; `Units\BuffData.slk` + `BuffFunc.txt`;
  `Units\MiscData.txt` + `MiscGame.txt` (the last one through the edition/patch chain —
  `miscGame()`, not the raw file).
* Values are returned as strings, as `SlkValue::to_string` does.
* `pairs(table)` and `table.factory` behave as YD's proxy.
* Column-name case: `MappedData` lowercases; lookups are case-insensitive to match.
* This is phase 3. It is the largest data-shaped surface and the least used by maps.

### 5.11 `jass.message`

YD's message module is an HWND-level input filter plus direct command-card and order
injection (`libs_message.cpp:137-199`, `201-350`, `676-724`):

| member | behaviour |
|---|---|
| `hook = fn` / `hook = nil` | install/remove an input filter; `fn(event)` returns false to swallow |
| events | `key_down`, `key_up`, `mouse_down`, `mouse_up`, `mouse_ability` with `code`, `x`, `y`, `ability`, `order` |
| `keyboard.*` | VK constants |
| `mouse()` | world coordinates under the cursor |
| `button(x, y)` | command-card slot → `(abilityId, orderId, targetType)` |
| `selection()` | the local player's primary selected unit |
| `order_immediate/point/target` | issue an order as the local player |

In the browser this is an **injected bridge** (`LuaInputBridge`) implemented beside the HUD:

```ts
interface LuaInputBridge {
  mouseWorld(): { x: number; y: number };
  commandButton(x: number, y: number): { ability: number; order: number; targetType: number } | null;
  selectedUnit(): number;                     // handle id
  issueOrder(kind: "immediate" | "point" | "target", order: number, x?, y?, target?, flags?): boolean;
  setFilter(fn: ((ev: LuaInputEvent) => boolean) | null): void;
}
```

Phase 4. Ship `mouse`, `selection` and `hook` first (they read existing state); the order
injection goes through the same `RtsController.execute` gate as a click, never around it.

### 5.12 `jass.console` and `jass.log`

* `console.write(...)` → `console.info` with a `[lua]` prefix (already the `print` sink).
* `console.enable = true` → an optional dev overlay panel (only if it earns its place; the
  browser already has a console). `console.read(fn)` has no stdin and never fires.
* `log.path` is accepted and stored but has no filesystem behind it; `log.level` filters
  `trace/debug/info/warn/error/fatal`; every call formats `timestamp [level]: args` and goes
  to the console sink. The YD `level` getter has a bug (`lua_tointeger(L, 1)` reads the
  table); do not reproduce it.

### 5.13 Not ported

| module | why |
|---|---|
| `jass.bignum` | RSA verification for loading signed DLLs. There are no DLLs and no `LoadLibrary`; shipping an RSA verifier would add attack surface for nothing. The module exists as an empty table. |
| `jass.debugger` | loads an external `debugger.dll` and speaks DAP-like traffic on port 4278. No external process to attach; empty module. |
| `jass.ai` | a `DebugS` mapping for debug-AI experiments; no map contract. Empty module. |
| `jass.storm` | a deprecated `io.open` shim; we provide `load(name)` over the map archive and `save = false` only if a corpus map needs it. |

`jass.japi` is also effectively empty beyond `EXExecuteScript` — the original's content is
whatever plugins registered at runtime, which is unknowable. That is stated, not guessed.

---

## 6. JAPI — the native library behind `jass.japi`

`yd_jass_api` (`KKWE3/Development/Plugin/Warcraft3/yd_jass_api`, 3 376 lines) is the plugin
that gives YDWE its `EX*` natives. It matters twice: it is the content `jass.japi` exposes,
and the same names are ordinary JASS natives a `#include "KKAPI.j"` map calls directly.

### 6.1 What `japi_add` actually does

Every registration in the plugin is one of two calls (`Initialize.cpp`, `DllMain.cpp`):

```cpp
jass::japi_add(func, "EXGetUnitInteger", "(II)I");
jass::japi_hook("GetUnitState", &RealGetUnitState, (uintptr_t)FakeGetUnitState);
```

`japi_add` does **two** things (`ydbase/base/warcraft3/jass/hook.cpp:352-356`):

1. `async_add(func, name, param)` queues the function into the game's **JASS native
   registry** (`nf_register.cpp` intercepts the VM's own registration path, which is why the
   call is "async" — it can happen before the VM exists). This is what makes
   `call EXSetUnitInteger(...)` legal in plain JASS.
2. `japi_func_add(name, func, param)` inserts a `func_value` (signature + address) into the
   `japi_function` map (`func_value.cpp:168, 192-226`).

`japi_hook` hooks an existing native **and** files the fake under the same name in
`japi_function` (`hook.cpp:229-234, 275-296`). So the two Lua tables answer different
questions:

| Lua table | source | contains |
|---|---|---|
| `jass.common` | `jass_func(name)` — the JASS native mapping (`libs_common.cpp:24-30`) | the native table as it was when that mapping was first built; a late `japi_add` need not appear |
| `jass.japi` | `japi_func(name)` — the JAPI map (`libs_japi.cpp:27-33`) | every `japi_add` / `japi_hook` registration |

`jass.japi` is therefore a **facade, not an engine**. An empty registry is a valid — if
useless — implementation. That fact settles the ordering question below.

### 6.2 Two separable pieces

* **The JAPI registry and the `jass.japi` table** — a map lookup plus a signature parser.
  Small, and it does **not** block the Lua core (P1).
* **The JAPI function library** — the actual natives. This is a separate compatibility
  workstream, and it is not Lua-specific: every function it adds is also visible to JASS.
  It is what a YDWE map *calls*, so a Lua dialect with an empty `jass.japi` starts the map
  and then fails at the first `EX*` call.

**Do not port JAPI first as a monolith.** Port the registry early, then a corpus-ranked
function pack. The rest of this section is that pack.

### 6.3 The `yd_jass_api` inventory and where each group lands

#### Unit — TYPE data (`EXGet/SetUnit{Integer,Real,String,ArrayString}`)

The four accessors are raw 4-byte slot reads and writes into the shared unit-type data block
(`UnitState.cpp:679-795`): `*(T*)(GetUnitData(unitcode) + id * 4)`. They are not per-instance
state and they are not the same numbering as `BlzGetUnitIntegerField` (ours is an array
position — see the note at the top of `src/compat/blzFields.ts`).

We have no `CUnitData` layout and no slot table in this repo. Only two indices are proven by
in-repo callers: **10 = the name string array** and **61 = the proper-name string array**,
both with their count in the integer slot (`KKAPI.j:105-114` — `DzSetUnitTypeName`,
`DzSetHeroTypeProperName`). Verdict:

* implement the API shape and those two indices against the unit-type registry;
* for any other index return the typed default and log the index once — that log is the
  input to a later slot table, and it never corrupts a stat silently;
* do not invent the slot table. It is external documentation (YDWE's advanced unit-data
  system) or an RE task, and a wrong row writes a wrong field.

#### Unit — INSTANCE state (`GetUnitState` / `SetUnitState` hooks, `0x10`–`0x61`)

`FakeGetUnitState` / `FakeSetUnitState` extend the two standard natives with attack-1/2
fields, armour and armour type, regen, acquisition and minimum range, move type and target
types (`UnitState.cpp:1-140, 142-430`). This is per-unit state and maps onto what the sim
already holds: weapon slots, attack cooldown/range/type, defence, regen, acquire range,
minimum range, move type. Add a second dispatch table over the same `sim` reads/writes as
the standard indices. Rows with no sim field (spill radius, damage-loss factor) are declared
and not answered.

The helpers map as follows:

| function | OpenWar3 target | verdict |
|---|---|---|
| `EXPauseUnit(u, flag)` | the sim's stun/pause state (`add_stun` / `remove_stun` in the original) | implement |
| `EXSetUnitFacing(u, angle)` | the sim's facing setter | implement |
| `EXSetUnitMoveType(u, type)` | per-unit move type (foot/fly/hover/…) | partial — only if the sim has a per-unit override |
| `EXSetUnitCollisionType(enable, u, type)` | the sim's `noCollision` covers the movement bit; other bits need their own fields | partial |
| `EXGetObject(handle)` | a process pointer; meaningless here | return 0, log once |

#### Ability — instance and data

This is the group that fits best, because the 1.31 path is already built:

| YD function | OpenWar3 equivalent | verdict |
|---|---|---|
| `EXGetUnitAbility` / `EXGetUnitAbilityByIndex` | `BlzGetUnitAbility` / `BlzGetUnitAbilityByIndex` — interned instance handles (`natives/abilityFields.ts`) | implement |
| `ExGetUnitSpellAbility` | same, filtered to the spell book (`unitAbilityAt`) | implement |
| `EXGetAbilityId` / `EXGetAbilityLevel` | the `AbilityInstanceRef` and its level | implement |
| `EXGet/SetAbilityState(…, ABILITY_STATE_COOLDOWN = 1)` | the sim's cooldown for that instance | implement |
| `EXGet/SetAbilityData{Real,Integer,String}` | the documented `data_type` table 100–116 / 200–220 (`YDWEAbilityState.j`) mapped onto `AbilityDef` and the per-instance def already used by `Blz*Ability*Field` | implement |
| `EXSetAbilityAEmeDataA` | the metamorph / `UnitTransform` hack | implement through the sim's morph path, or declare-not-answered |
| `EXGet/SetBuffDataString` (art 1, tip 2, ubertip 3) | buff art lives in the install's data; reads are exact, writes need a per-map overlay | read now, write later |
| `EXGet/SetAbilityString` (art/tip/… per level) | the same overlay, by level | read now, write later |

The `data_type` constants are written down in the JASS headers, not guessed. The mapping to
our fields is a table in the compat layer; a row we cannot answer is declared-not-answered.

#### Item

`EXGet/SetItemDataString` (art 1, ubertip 3, name 4 per `YDWEState.j`; the C++ also touches
tip/description) reads and writes the item-type row. Our item registry plus a per-type
override layer is enough. Small, implement with pack A.

#### Damage

`EXGetEventDamageData(0..6)` and `EXSetEventDamage(r)` are the YD spelling of what we already
have in `Runtime.damageStack` / `GetEventDamage` / `BlzSetEventDamage`. The seven type ids are
documented in `YDWEEventDamageData.j`. Nearly a rename; implement with pack A.

#### Effect

`EXGet/SetEffectX/Y/Z`, `EXSetEffectSize`, `EXSetEffectSpeed`, and the five matrix calls
(`EXEffectMatRotateX/Y/Z`, `Scale`, `Reset`) operate on the effect's model instance
(`Effect.cpp:223-236`). Position and size are feasible if our effect handles expose the
instance transform; matrix rotation/scale is renderer work. Position/size in pack B, matrix
in pack C.

#### Chat, icons, code hooks

| function | target | verdict |
|---|---|---|
| `EXDisplayChat(p, recipient, msg)` | the existing chat display path; recipients 0=all, 1=allies, 2=observers/referees, 3=private (`YDWEJapiOther.j`) | pack B |
| `EXDclareButtonIcon(path)` / `EXBlendButtonIcon(a,b,out)` | an in-memory virtual BLP over the asset resolver (`assetSolver` / `derivedArt` are the seams) | pack C or stub returning false |
| `KKHookCode*` | scaffolding for `jass.code`'s C++ trampolines; `HookCode.cpp` itself says "Do not use it directly. Use the `jass.code` package via Lua." | do not implement |

### 6.4 Signatures are data

The `param` argument is a compact JASS signature — `(Hunit;I)Hability;`, where `I` int,
`R` real, `B` bool, `S` string, `H<type>;` handle, `C` code, `V` void. Parse it once into
`{ params, returns }` and fill `rt.nativeParams` / `rt.nativeReturns`. That one table then
drives:

* `jass.debug.functiondef`;
* the typed default an unimplemented JAPI name answers;
* the Lua bridge's conversions (no per-function wrapper code).

Write our own declaration table in `src/compat/lua/japi/decl.ts`, grouped by the YD source
module, one comment per row naming where the behaviour is documented. Do not copy KKWE3's
`.j` headers into the repo — they are the source's API listing, and our table is ours.

### 6.5 Implementation order inside JAPI

1. **Registry + facade + signature parser** (P2a, 0.5–1 d): `rt.japi`, `rt.nativeParams`,
   `jass.japi`, `jass.debug.functiondef`, `EXExecuteScript`.
2. **Pack A** (P2b, 2–3 d): damage → item → ability → unit state. That order is by
   distance from what already exists, so each step is small and testable.
3. **Pack B** (P3+): effect position/size/speed, `EXDisplayChat`.
4. **Pack C** (only if the corpus demands it): matrix transforms, virtual button BLPs,
   individual `Dz*` names from `kkapi`.

`kkapi` is a different, much larger surface: roughly **530** JAPI registrations, over
**500** of them `Dz*` (frames, doodads, sprites, model cache, …). It is a decade of engine patches, not a
portable library. Out of scope unless P0 finds specific corpus calls; then add them one at
a time with the same declaration-first discipline.

### 6.6 The answer to "should JAPI come first?"

No, not as a prerequisite, and yes as a workstream:

* `jass.japi` is a facade; the Lua core (P1) and the facade (P2a) are independent. Putting
  JAPI ahead of `require`/`jass.common` would invert the dependency — a map cannot even
  reach `jass.japi` without `require`.
* But a *working* YDWE Lua map needs the functions it calls. Pack A is therefore required
  before the dialect can be called finished, and it should be scheduled immediately after
  P1/P2a — not deferred behind the introspection modules.
* Because every JAPI function is also a JASS native, pack A pays off on JASS maps that
  never touch Lua. That is the strongest reason to treat it as its own track rather than a
  Lua detail.

### 6.7 Acceptance for pack A

* A JASS map (and a Lua map through `jass.japi`) reaches the same implementation of
  `EXGetUnitAbility`, `EXGetAbilityData*`, `EXGet/SetEventDamage`, `EXPauseUnit` and
  `EXSetUnitFacing`.
* Every registered name answers `jass.debug.functiondef` with the declared signature.
* A registered-but-unimplemented name returns its typed default and logs once — no Lua
  error, no silent null call.
* A name outside the registry still answers `nil` / an unknown-function note.

## 7. Entry points

### 7.1 `war3map.lua`

Already works and must keep working. With `require` now present, an official Lua map that
uses `require "jass.common"` also starts working; the `_G` bridge stays for the corpus map
that calls names directly.

### 7.2 `exec-lua:`

YD hooks the `Cheat` native (`lua_loader.cpp:75-90`): a string beginning `exec-lua:` is
trimmed, optional quotes stripped, and the rest is `require`d. Our Lua host does the same
while it is installed:

* wrap `rt.natives.get("Cheat")` with a function that tests the prefix, `require`s the
  module, and otherwise forwards to the original;
* restore the original in `dispose`;
* the path still goes through the same sandboxed `require` as any other module;
* `exec-lua:` is map content, not a player cheat, so it is not gated on single-player.

### 7.3 `EXExecuteScript`

Register in the JAPI registry (§5.6). Evaluate synchronously on the same state; a Lua error
becomes a null result plus `error_handle` (as `lua_loader.cpp:98-107` does).

### 7.4 Bootstrap order

The chunk runs after `common.j`, the compat prelude and `blizzard.j` are loaded
(`src/jass/index.ts:136-143`) — which is exactly what the modules resolve into. Modules are
lazily opened on first `require`, so a map that never touches Lua pays only for the state.

---

## 8. Sleep, threads and errors

### 8.1 Where a wait can park

| call site | a wait means |
|---|---|
| Lua function driven by the engine on a thread (trigger action, timer handler) | coroutine yields seconds; the interpreter resumes it (`host.ts:211-244`) |
| Lua chunk top level | warn once, carry on (no coroutine) |
| a Lua callback reached synchronously (condition, filter, `ForGroup`, hook, `jass.code`) | warn once, abandon the callback |
| a JASS BJ called from Lua that waits | the wait is adopted as a new JASS thread and the Lua call returns null (documented existing limitation) |

With `runtime.sleep = false`, the four sleeping functions — `TriggerSleepAction`,
`TriggerSyncReady`, `TriggerWaitForSound`, `SyncSelections` (the list is YD's,
`libs_common.cpp:106-121`) — become no-ops with one warning, matching YD's off state.

**Default.** YD ships `sleep = false`; the shipped runtime script turns it on. Official
1.31 Lua maps expect waits to work without stating anything. Our host therefore defaults to
**true**; a YD map that explicitly sets `false` gets YD's off semantics. This is a
deliberate divergence and is listed in §13.

### 8.2 Errors

* Compile/load error: `load` throws; the caller opens the map with no triggers and logs once
  (`src/jass/index.ts:144-146`).
* Runtime error inside a coroutine: call `error_handle` if set, log once, keep the state
  usable.
* Error inside `error_handle`: log and drop — never re-enter.
* A JS exception from a native is already turned into a typed default by the interpreter;
  `catch_crash` is accepted but does not change that.

---

## 9. Sandbox and trust boundary

A map is untrusted content (`docs/map-compatibility.md`). YD's sandbox is weaker than ours
(it keeps `io`, `os`, full `debug`, opens archive files into a temp directory, and loads
RSA-signed DLLs when enabled — `fix_baselib.cpp:225-269`, `libs_package.cpp:171-276`).
OpenWar3 keeps the closed door:

| capability | decision |
|---|---|
| `io`, `loadfile`, `dofile`, `load`, `loadstring`, `collectgarbage` | removed |
| `os.execute/exit/remove/rename/getenv/tmpname/setlocale` | removed |
| `os.time/clock/date` | removed, for determinism (YD keeps them) |
| `package.loadlib`, `package.cpath`, DLL searcher | do not exist |
| `debug` | **keep `traceback`** (YD's own `error_handle` convention needs it); keep `getinfo` read-only if fengari's is safe; remove `sethook`, `debug`, `getregistry`, `setupvalue`, `setmetatable`-adjacent escape hatches |
| `require` | `jass.*` preloads + map-archive `*.lua` only; no `..`, absolute paths, drives, `:`; no install/disk access |
| `EXExecuteScript` | same state, same sandbox |
| `exec-lua:` | same `require` |

A Lua module in the map may read any other file in that same map archive. That is the same
trust the map already has over its own script; it is not a fog or install bypass.

---

## 10. Determinism

The sim is lockstep; Lua must roll the same numbers and take the same branches everywhere.

* **RNG**: `math.random` / `math.randomseed` are replaced (`fix_baselib.cpp:19-67`) to draw
  from `Runtime.random()` and `SetRandomSeed` — the game's own stream. This is the YD
  behaviour and the reason a map that mixes `GetRandomInt` with `math.random` stays in sync.
  `random(n)` and `random(a,b)` use YD's formula (`r*(up-low+1)+low`).
* **No clock**: `os.date/time/clock` are gone; `performance.now` is only used by
  `perftrace`, never by a game-visible value.
* **Iteration order**: module `pairs` sorts where the order could escape into the world
  (published function names, as `host.ts` already does). A script's own `pairs(_G)` remains
  the script's problem, exactly as in Lua.
* **`require`** caches by name and the map archive lookup is deterministic.
* **Logging** never writes the world or consumes randomness.

---

## 11. Testing

### 11.1 Extend `tools/jass-lua-test.cjs`

The existing assertions stay. Add:

1. `require "jass.common"` returns a table; `CJ.CreateTrigger()` returns a handle;
   `CJ.EVENT_PLAYER_UNIT_SPELL_EFFECT` is the same number as the global.
2. `require "jass.globals"` reads and writes `bj_MAX_PLAYERS` / `bj_isSinglePlayer`; an
   array proxy writes are visible to the interpreter and vice versa.
3. `require "jass.runtime"`: `version == 3`; `handle_level` round-trips; `error_handle`
   receives the message of a deliberate error; `sleep = false` makes a direct
   `TriggerSleepAction` a warned no-op.
4. `require "jass.hook"`: hook `GetUnitState`-style native, assert the callback sees typed
   args, `real(...)` returns the original answer, and `= nil` restores.
5. `require "jass.debug"`: `h2i(i2h(h)) == h`; `globaldef` reports a declared type;
   `handledef` names the handle's type.
6. `require` from a **virtual map archive** (a fake `rawBytes`): a `blizzard.lua` shipped by
   the map loads; the built-in fallback is used when it is absent; `../x` is refused.
7. Sandbox: `io`, `os`, `load`, `loadfile`, `dofile` are nil; `require` raises for a
   non-existent module; `debug.traceback` exists while `debug.sethook` does not.
8. Determinism: two consecutive `math.random()` calls equal two consecutive
   `GetRandomReal(0,1)` calls from the interpreter's stream.
9. `dispose` removes every host function and restores a hooked native.
10. Null handle: a native returning a null handle arrives as `nil` (not a box).

### 11.2 A YD dialect corpus

Re-author, do not copy, the shape of the shipped example (`main.lua` + a minimal
`blizzard.lua`): a trigger over `TriggerRegisterPlayerUnitEvent`, a Lua condition comparing
`GetSpellAbilityId()` to a `FourCC`-equivalent, a `TimerStart` closure capturing an upvalue,
and an anonymous action. This is the smoke test that the module dialect — not just the
official one — starts a match.

### 11.3 In the running game

Non-visual, so no screenshot requirement; use `?dev` with a map whose script is Lua. Add
one log line per opened module (name + version) so a report can tell which surface a map
actually used. If `jass.console` grows an overlay, it is a visual feature and gets the
usual before/after shots.

### 11.4 Commands

```
pnpm typecheck
pnpm jass:test              # includes tools/jass-lua-test.cjs
node tools/map-compat.cjs --check   # the install's own maps stay unaffected
```

---

## 12. Phases

Estimates assume one developer and the existing test harness.

| phase | scope | acceptance | estimate |
|---|---|---|---|
| **P0 — survey** | a small tool that scans maps for `require "jass.`, `exec-lua:` and `EX*` / `Dz*` call sites (in both dialects) and counts the modules, JAPI names and unit-data indices actually reached | a report naming the modules and JAPI functions worth implementing first | 0.5–1 d |
| **P1 — core dialect** | `require`/`package`, map-archive searcher, `jass.common`, `jass.globals`, array proxies, `jass.runtime`, `jass.debug`, handle modes, null handles, `code` closures, `error_handle`, RNG wiring, `debug.traceback` | the YD corpus in §11.2 runs; all §11.1 items 1–3, 5, 7–10 pass | 2–3 d |
| **P2a — hooks and doors** | `jass.hook`, the JAPI registry + signature parser + `jass.japi`, `EXExecuteScript`, `Cheat("exec-lua:")`, `jass.console`, `jass.log` | item 4 passes; a map can hook a native and reach Lua from JASS; `jass.debug.functiondef` answers a registered JAPI name | 1–1.5 d |
| **P2b — JAPI pack A** | damage → item → ability → unit state, in that order (§6.5), plus `EXPauseUnit`, `EXSetUnitFacing` | §6.7; a YDWE map that calls the pack's `EX*` names runs | 2–3 d |
| **P3 — introspection and data** | `jass.selector`, `jass.code` (+ interpreter seam), `jass.slk` | a table read matches `MappedData`; hero list matches `IsUnitType` | 2–3 d |
| **P4 — input and tail** | `jass.message` over the injected bridge, `jass.storm.load`, JAPI packs B/C as the corpus demands, stubs, docs, perf | a hook sees key/mouse events; docs updated; no regression | 2–3 d |

P1 is the whole value of the dialect, and **P2b is what makes a YDWE map actually do
something**: a Lua map that starts and then calls an unimplemented `EX*` is not a working
map. P2a is a facade over P2b and can land in parallel with P1; P2b is the function pack.
P0 may compress the rest further: if no corpus map uses `jass.slk` or `jass.message`, those
phases should be dropped rather than half-built.

---

## 13. Divergences and open questions (deliberate, listed)

| # | divergence | why | revisit |
|---|---|---|---|
| 1 | `runtime.sleep` defaults **true** (YD: false) | official 1.31 Lua maps expect working waits; a YD map that cares sets it explicitly | if P0 finds maps relying on the off default |
| 2 | `handle_level = 2` is userdata **without refcounting** | JS owns handles; a `__gc` refcount would be a lie | never, unless a map depends on `__gc` |
| 3 | no `io` / `os` / full `debug` | untrusted map content; browser has no filesystem | `debug.traceback` stays; revisit only for a concrete map |
| 4 | no DLL loading / RSA / `jass.bignum` | no process, no plugins, and it is an attack surface | never |
| 5 | no external debugger | no process to attach | never |
| 6 | a wait through a JASS BJ cannot suspend the Lua caller | JS call boundary; the wait is adopted as a JASS thread instead | fengari would need a resumable C-call protocol |
| 7 | `jass.slk` values are raw columns, not `ObjectManager` conversions | we do not ship a second object model; the data layer is typed | if a map needs a converted field |
| 8 | `jass.message` is an injected bridge, not an HWND filter | browser input is DOM; the order path must go through `RtsController.execute` | phase 4 |
| 9 | `math.random` consumes the game's RNG stream | matches YD and keeps mixed RNG in lockstep | never |
| 10 | `reals` are doubles by default | the sim is double; rounding only Lua would disagree with it | optional `f32` after a corpus test |
| 11 | YDWE's `\|AHhb\|` literal is a **compiler** feature, not runtime | the source engine does not preprocess it either; a map ships the already-converted form | do not add a preprocessor |
| 12 | `EXExecuteScript` and `exec-lua:` are not single-player-gated | they run map content, not player cheats | if a network-policy reason appears |
| 13 | a JAPI name is also visible through `jass.common` (YD keeps the two maps separate) | it is registered as a real native, which is what `japi_add` does to the JASS table; the superset cannot hurt a script | if strict dialect separation is ever needed |
| 14 | `EXGet/SetUnit{Integer,Real,String,ArrayString}` answers only the slot indices we can source (10 = name, 61 = proper name) | the index is a raw `CUnitData` slot and we have no layout table; guessing writes the wrong stat | source the YDWE slot table before adding rows |
| 15 | `EXGetObject` returns 0 | it is a process pointer, not an object id | never |
| 16 | `KKHookCode*` are not implemented | they are C++ trampoline scaffolding for `jass.code`, not a map API; our `jass.code` uses the interpreter seam | never |
| 17 | `kkapi`'s 500+ `Dz*` functions are out of scope | a decade of engine patches, not a portable library | corpus-driven, one name at a time |

### Open questions for P0

1. Which modules does the corpus actually use? (`jass.common`, `jass.globals`,
   `jass.runtime` are near-certain; `jass.slk` and `jass.message` may be tooling-only.)
2. Do any YD maps ship `war3map.lua` (rather than `exec-lua:` from JASS)? The loader path
   differs slightly: the chunk runs before `config()`.
3. Does any map set `runtime.sleep = false` on purpose? If so, honour it and the default
   question is settled by data, not by us.
4. Are maps stored with `lua/` as a directory prefix, or flat (`blizzard.lua`)? The default
   `package.path` above covers both; P0 should confirm the real distribution.
5. Which `EX*` names does the corpus call, from either dialect? That ranking is the content
   of JAPI pack A, and it should be read off call sites rather than guessed from the plugin.
6. Does any map call `EXGet/SetUnitInteger` with an index other than 10 / 61? If so, collect
   the index and the value that was written — that is the evidence a slot table needs.

---

## 14. Legal and sourcing

The port is a **re-implementation of a public API contract** in TypeScript. No YDWE C++
code, table or asset is copied; the module names and the shapes they answer come from the
plugin's own registration code and the shipped example scripts, and every behaviour above
is cited to the file and line that establishes it. Nothing from Blizzard is lifted: the
JASS API surface comes from the player's own `common.j` / `blizzard.j`, and the raw SLK
reader reads the player's own install at runtime.

The same boundary as the rest of `src/compat/`: this layer must stay removable. If the
modules are not required, a map must behave exactly as it does today.
