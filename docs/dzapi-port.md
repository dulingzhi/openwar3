# `dz_w3_plugin` → OpenWar3: porting the DzAPI native layer

**Status (2026-10-21): P0, P1 and P2's CORE are DONE.** P1 covers strings, bits, groups,
text tags, unit DB, effect extras, selection/minimap and the system/debug subset; P2's core
covers create/find/destroy, points, size, text, show/enable/alpha/scale/texture, parent/
children, value/min-max/step, priority, colour/font/alignment and the origin-frame getters.
`pnpm dzapi:test` pins them. The remaining P2 pieces are frame scripts/update callbacks and
model frames; P3's input/sync triggers are next. All 394 names are generated into
[`src/compat/lua/japi/dzapi-decl.ts`](../src/compat/lua/japi/dzapi-decl.ts) by
`pnpm dzapi:decl` and registered as JAPI aliases, so `jass.japi`, `jass.common` and `_G`
all reach them with their signatures; an unimplemented one answers its typed default and
logs once. The packs below replace those defaults. This document covers the JAPI surface in
`F:\Projects\dz_w3_plugin\src\plugin` — the second native plugin after `yd_jass_api`
(whose contract is already ported, see [`lua-engine-port.md`](./lua-engine-port.md)).

`kkapi`'s own extra `Dz*` registrations are **out of scope** for this plan (the developer's
current instruction); this document covers exactly the 394 names registered by
`dz_w3_plugin/src/plugin`.

Do not confuse the two mechanisms:

| | `yd_jass_api` | `dz_w3_plugin` |
|---|---|---|
| registration | `japi_add` / `japi_hook` | `RegisterNativeFunction` into the GAME's native table |
| names | 52 `EX*` + 3 hooks | 355 `Dz*` + 35 `DzAPI_Map_*` + 4 `RequestExtra*` |
| Lua visibility | `jass.japi` (and `jass.common` after a late add) | `jass.common` / `_G` as an ordinary native; `jass.japi` only if we alias |
| module style | one proxy table per module | one `apis[]` table per source file |

So a DzAPI name belongs in `Runtime.natives` first. We may additionally alias it into
`Runtime.japi` (for `jass.japi` maps and `jass.debug.functiondef`), but the native table is
the authority.

---

## 1. What the plugin registers

394 registrations, parsed from the `FUNC_ITEM(func, sig)` / `JASS_REGISTER_EX(func, name, sig)`
tables of the six `war3japi_*.cpp` files:

| source file | registrations | what it covers |
|---|---:|---|
| `war3japi_gui.cpp` | 126 | frames, UI events, engine frames, screen/world conversion |
| `war3japi_plus.cpp` | 113 | units, abilities, items, doodads, effects, map/system extras |
| `war3japi_extend.cpp` | 59 | strings, bit ops, groups, order queues, text tags, XLSX |
| `war3japi.cpp` | 40 | 35 `DzAPI_Map_*` platform calls + 4 `RequestExtra*Data` + `DzDebugString` |
| `war3japi_hardware.cpp` | 32 | mouse, keyboard, window, FPS/window mode |
| `war3japi_packet.cpp` | 14 | `DzSync*` and app-event packet surfaces |
| `war3japi_db.cpp` | 10 | per-UNIT object-data overrides (name, portrait, missile, …) |

The compact signature is YD's own form (`(Hunit;I)Hability;`), the same grammar already parsed
by [`src/compat/lua/japi/signature.ts`](../src/compat/lua/japi/signature.ts).

Many platform functions are wrapped in `CHECK_IS_RPG_LOBBY_OR_LADDER` /
`CHECK_IS_RPG_LADDER` macros: in a release build they do nothing unless the map is running in
an RPG lobby or ladder. An offline OpenWar3 match is neither, so their honest answer is the
typed default (0 / false / "" / null). That is a **policy**, not a missing implementation.

The implementation is full of process memory, window handles, engine offsets and a server
connection. We port the **contract** (names, signatures, local semantics), never the DLL.

---

## 2. Inventory and support matrix

Counts are per distinct name; a few names appear in more than one module and are counted once.

| category | count | OpenWar3 target | difficulty | phase |
|---|---:|---|---|---|
| **GUI / frames** | 126 | [`src/compat/frames.ts`](../src/compat/frames.ts) `FrameObj`/`FrameModel` + [`src/ui/scriptFrames.ts`](../src/ui/scriptFrames.ts) drawing | large (3 sub-packs) | P2 |
| **platform map** | 35 | offline policy + optional local profile store | small, policy-heavy | P5 |
| **hardware / input** | 32 | DOM events, canvas/stage size, camera ray, input bridge | medium | P3 |
| **unit / ability** | 28 | sim + renderer; per-unit overrides | medium–large | P4 |
| **doodad** | 22 | runtime doodad actors in the renderer | medium | P4 |
| **system / misc** | 21 | browser equivalents or honest no-ops | small–medium | P1/P6 |
| **orders** | 17 | sim order queue (`issueUnitOrder`) | medium | P4 |
| **other (input/preview/shop)** | 16 | `RtsController` target/build modes, shop view | medium | P3–P4 |
| **sync / packet** | 14 | match link sync channel; single-player no-op | medium | P3 |
| **effect** | 13 | existing `specialEffect*` hooks | small | P1 |
| **string** | 12 | pure JS | trivial | P1 |
| **bit** | 11 | pure JS | trivial | P1 |
| **unit DB** | 10 | per-unit overrides (`SimUnit` fields + renderer model) | small | P1 |
| **XLSX** | 9 | needs ZIP + XLSX reader | large | P6 (optional) |
| **text tag** | 6 | `TextTagObj` + text-tag overlay | small | P1 |
| **map / environment** | 5 | sim/renderer | medium | P4 |
| **selection / minimap** | 5 | renderer selection + minimap icons | small | P1 |
| **item** | 5 | renderer item instances | medium | P4 |
| **platform request** | 4 | local request table / 0-default | small | P5 |
| **group** | 2 | existing group table | trivial | P1 |
| **player / tech** | 1 | sim tech tree | trivial | P1 |

**Every category has a home in the existing engine** except XLSX (no archive-independent
spreadsheet reader) and the process-memory/window functions (deliberately not emulated).

---

## 3. What each category means in our engine

### 3.1 Pure data: strings, bits, groups (25)

`DzString*` (12), `DzBit*` (11), `DzGroupGetCount/GetUnitAt` (2).

These are ordinary functions over Lua/JASS values. Implement in one `dzapi/values.ts` pack:
- string find/trim/replace/insert/reverse — exact C++ semantics (the source uses `std::string`);
- bit get/set/byte/shift/not/and/or/xor/toInt — 32-bit, matching the source's `DWORD`;
- groups read the live `group` handle (our `Runtime` group table).

No UI, no sim. This is the cheapest pack and a good first commit.

### 3.2 Text tags (6)

`DzTextTagGet/SetFont`, `…StartAlpha`, `…ShadowColor`.

Our `TextTagObj` already has text/colour/position/life. Add `font`, `startAlpha`,
`shadowColor`; the text-tag overlay reads them. The getter/setter pair is one function each.

### 3.3 Selection / minimap (5)

`DzGetLocalSelectUnitCount`, `DzGetLocalSelectUnit`, `DzGetSelectedLeaderUnit`,
`DzWidgetSetMinimapIcon`, `DzWidgetSetMinimapIconEnable`.

The first three read the local selection (`RtsController.selected*`); the last two set a
per-unit minimap icon override in the renderer (a map path, drawn instead of the team dot).

### 3.4 Unit DB (10) + effect extras (13)

**Unit DB** (`war3japi_db.cpp`): `DzSetUnitName`, `ProperName`, `Portrait`, `Description`,
`CollisionSize`, `MissileModel/Arc/Speed/Homing`, `PreselectUIVisible`.

These are **per-unit** overrides, not type-table edits. `SimUnit` already has
`nameOverride`/`properName`; add `portrait`, `description`, `collisionSize`, `preselectUI`;
the missile four are per-unit weapon overrides the sim already understands for the attack path.
The renderer reads the name/portrait through the same snapshot the info panel uses.

**Effects** (`war3japi_plus.cpp`): `DzSetEffectPos`, `Set/GetEffectVertexColor/Alpha`,
`SetEffectScale`, `SetEffectVisible`, `SetEffectModel`, `SetEffectTeamColor`,
`SetEffectAnimation`, `PlayEffectAnimation`, `BindEffect`, `UnbindEffect`.

All but the last two map to the effect hooks we already wrote for `EXEffectMat*`
(position, colour, alpha, scale, team colour) plus a model swap and an animation call.
`DzBindEffect`/`UnbindEffect` are the renderer's `setParent`/`detach` on the effect instance
already used by buff carriers.

### 3.5 Orders (17) + order-list extras

`DzQueueIssue*OrderById` and `DzQueueGroup*OrderById` enqueue an order instead of replacing
the current one; `DzUnitOrdersCount/Reverse/Clear/Exec/ForceStop` inspect or rewrite a unit's
order list.

Our sim has one current order per unit (`SimUnit.order`) and a queued list for shift-clicks;
the plan is to expose that list as the order list:
- `Count` = queue length + 1;
- `Reverse`/`Clear`/`Exec`/`ForceStop` operate on the queue while preserving the sim's own
  gates;
- the six `DzQueueIssue*` are the existing order funnel with `queued: true` (our
  `RtsController.execute` already has a `queued` flag for shift-click).

### 3.6 Unit / ability (28) + items (5)

Mixed, all per-unit or per-item:
- silence, disable attack, disable inventory, targetable, selectable, alpha, HP-bar,
  overhead offset, level: sim flags the renderer/HUD already read;
- `DzSetUnitModel`, `DzSetUnitTexture`, `DzSetUnitID`, `DzSetUnitDataCache*`,
  `DzUnitUIAddLevelArrayInteger`: per-map object-data overrides through
  `UnitRegistry.setCustom` (a clone, never the stock row) plus a renderer model/texture swap;
- illusions, revive, patron, attack ability, ability enable/string data: the ability-instance
  and morph/revive paths already exist;
- items: per-instance model/portrait/vertex colour/alpha through the item instance layer.

### 3.7 Doodads (22)

`DzDoodadCreate/Remove`, position/rotation/scale/colour/team colour, visibility,
animation/time-scale/query. The renderer already has a doodad-actor layer for animated
doodads; promote it to a per-id runtime table and expose the values the natives read.
`DzDoodadGetAddress` returns 0 (no process pointer), like `EXGetObject`.

### 3.8 GUI / frames (126)

This is the biggest pack and the one the corpus asks for most. Our `FrameObj` already models
name/type/parent/visible/enabled/alpha/scale/text/texture/value/width/height/anchors/tooltip;
the drawing is `ScriptFrameOverlay`. The DzFrame* surface is a near-superset of the 1.31
`Blz*Frame*` family we already have, so the plan is **extend the one model, never add a
second UI system**:

- **create/destroy/find** (≈12): `DzCreateFrame[ByTagName]`, `DzCreateSimpleFrame`,
  `DzSimple*FindByName`, `DzDestroyFrame`, `DzGetGameUI`, `…SimpleUIParent`, `…CursorFrame`;
- **layout** (≈14): `SetPoint/AbsolutePoint/ClearAllPoints/SetAllPoints/GetPoint*`,
  `SetSize/GetWidth/GetHeight`, `SetParent/GetParent/GetChild(ren)`, `SetScale`;
- **appearance** (≈25): show/visible, enable, alpha, text (+color/font/size/alignment),
  texture/texcoord/vertex color, model/animate, priority, clip;
- **events** (≈12): `SetScript[ByCode|Block|Async]`, update callbacks, triggering frame/player,
  click/focus, mouse cage — over the existing `BlzTriggerRegisterFrameEvent` model;
- **engine frames** (≈20): portrait, minimap, command bar, hero/item/minimap/upper buttons,
  info-panel buttons, peon bar. These are ORIGIN frames; map each Dz id to its FDF name in
  our origin-frame table;
- **simple-message frames** (2): our message area/chat log;
- **coordinate conversion** (≈7): world↔screen through the camera (already in `RtsController`);
- **window/UI look** (≈6): hide interface, wide screen, black borders, FOV fix, auto-reset;
  these are renderer/stage settings, not memorised engine state.

`DzLoadToc` maps to the existing `BlzLoadTOCFile`/`FdfLibrary` path: read the `.toc` and its
`.fdf` from the map archive, hand the text to the frame model. Our frame library deliberately
takes sources as text, so no second VFS path is needed.

### 3.9 Hardware / input (32)

Browser equivalents, through the existing `LuaInputBridge` where possible:

| function group | answer |
|---|---|
| mouse position/terrain x/y/z, wheel delta, key down, trigger key/player | DOM events + camera ray; the pointer world point already exists |
| `DzIsMouseOverUI`, `DzFrameCageMouse`, focus | pointer over HUD / pointer lock (the latter can only be requested, not forced) |
| window width/height/client/x/y, active, mode, resize event | `window.innerWidth`/`innerHeight`, visibility API, `resize` event; x/y and "window mode" are browser-owned |
| `DzChangeWindowSize`, `DzSetMousePos`, `DzSetClipboard` | request fullscreen / no-op / `navigator.clipboard` with permission |
| `DzGetFPS`, `DzToggleFPS`, `DzSetMaxFPS` | the HUD FPS readout and `render/frameCap.ts` |

The trigger registrations (`DzTriggerRegister*Event[ByCode]`) reuse the input filter we built
for `jass.message`: one filter, two consumers, same swallow rule.

### 3.10 Sync / packet (14)

`DzSyncData`, `DzSyncDataImmediately`, `DzSyncBuffer`, `DzTriggerRegisterSyncData`,
`DzGetTriggerSync*` are a named sync channel. Map them onto the existing match-link/chat
delivery path; in a single-player match they are local no-ops that still fire the registered
trigger for the local player (which is what a map's script expects).
`DzSendAppCommit`, `DzGetAppEvent*` are platform app events; offline → typed defaults.

### 3.11 Platform map / RequestExtra (39)

`DzAPI_Map_*` is a **server platform**: map level/rank, VIP, guild, mall items, server
archives, ladder stats, store toggles. None of it exists in an offline browser match.

Policy:
- **defaults**: `IsRPGLobby`/`IsRPGLadder` = false, `MatchType` = 0, levels/ranks/VIP/UserID =
  0, guild/archive strings = "", store/stat/update = no-op, `GetGameStartTime` = the match's
  start time;
- **local persistence**: `SaveServerValue`/`GetServerValue` and the public archive pair can use
  a per-PROFILE local store (the same shape as `gameCache.ts`), so a single-player RPG map
  keeps its save across sessions. That is useful and honest; it is not the platform's server
  archive;
- `RequestExtra*Data` answer from a small local request table keyed by the request enum, else
  the typed default. Document the unanswered ids.
- `CHECK_IS_RPG_LOBBY_OR_LADDER` gates are **not** reproduced as a reason to refuse: offline
  maps are never in an RPG lobby, so the release plugin itself would return the default.

### 3.12 System / misc (21)

| function | answer |
|---|---|
| `DzDebugString`, `DzWriteLog` | the host log sink (`[lua]`/console) |
| `DzGetLocale`, `DzGetMapFilePath`, `DzGetCodeName` | browser/install locale, the map's path, the code value's name |
| `DzSetMemory`, `DzSave/GetMemoryCache`, `DzDoodadGetAddress` | no process memory: 0 / no-op with one log |
| `DzSetSpeed` | the sim's game speed if it exists, else no-op |
| `DzSetMaxFPS`, `DzToggleFPS`, `DzGetFPS` | `render/frameCap.ts` + the HUD readout |
| `DzUnlockOpCodeLimit`, `DzUnlockBlpSizeLimit` | no-op: the limits do not exist here |
| `DzModelRemoveFromCache`, `DzModelRemoveAllFromCache` | the viewer's model cache |
| `DzGetJassStringTableCount`, `DzClearJassStringNotReference` | 0 / no-op: no interned string table here |
| `DzSetClipboard`, `DzOpenQQGroupUrl` | clipboard (permissioned) / open a URL in a new tab |
| `DzBlockSelectModeCommand` | the command gate in `RtsController` |

### 3.13 XLSX (9)

`DzXlsxOpen/Close` and cell/row/column reads. The original reads an `.xlsx` from the map.
Implementing it faithfully needs a ZIP reader (xlsx is a zip of XML) and a small shared-strings
/ cell parser; no dependency is needed, but it is a self-contained module. It is last because
no demo map in the corpus uses it and it cannot affect a match's simulation.

---

## 3.14 Real-map alignment (DSIII)

`F:\Games\War3\Maps\Test\DSIII.w3x` is the alignment map: a 62 MB, 1.7 MB-script JASS map
(no Lua) that calls **154** distinct Dz/EX names, overwhelmingly frames (366 `SetPoint`, 231
`CreateFrameByTagName`, 208 `SetText`, …). The tool mounts the developer's own 1.27 MPQ
install, loads its `common.j`/`Blizzard.j` and the map script, then runs `config()`/`main()`:

```
pnpm dsiii:align
```

It prints every native the map calls that this engine has not implemented, with call counts.
The baseline on 2026-10-21 was **33**; after P0+P1+P2-core it is **8**:

```
DzFrameSetAnimate, DzFrameSetModel, DzFrameSetScript, DzFrameSetUpdateCallback,
DzTriggerRegisterKeyEvent, DzTriggerRegisterMouseEvent,
DzTriggerRegisterMouseWheelEvent, DzTriggerRegisterSyncData
```

The first four are the rest of P2 (frame callbacks/model frames); the last four are P3
(input/sync triggers). The map has no Lua, so it validates the NATIVE contract, not the Lua
dialect — the five Lua demo maps (`pnpm lua:demo`) cover that.

**A structural rule this alignment produced:** DzAPI must be installed for EVERY map, JASS
included (`loadMapScript` calls `installDzapi`), not only when a Lua host exists. Before that
fix the map saw 33 missing natives even though all 394 declarations existed.

## 4. Phases

| phase | scope | acceptance | estimate |
|---|---|---|---:|
| **P0 — declaration** | generate a 394-row `{name, sig, module, category}` table from the source; register every name as a native with its typed default; optional `rt.japi` aliases | every name compiles, `jass.common` reaches all of them, a call to an unimplemented one answers the typed default and logs once; a table test pins names/signatures | 0.5–1 d |
| **P1 — pure packs** | strings, bits, groups, text tags, unit DB, effect extras, selection/minimap, debug/log/locale/map path, player-tech, `DzExecuteFunc` | `pnpm dzapi:test` — every pack's hook translation and value | DONE |
| **P2 — GUI/frames** | the 126 frame functions over `FrameObj`; **CORE DONE** (create/find/destroy, layout, text, show/enable/alpha/scale/texture, parent/children, value, priority, colour/font/alignment, origin-frame getters). Remaining: scripts/update callbacks, model frames, simple-message frames | `pnpm dzapi:test` frame checks; `pnpm dsiii:align` drops the missing list from 33 to the 4 callback/model names | 4–6 d |
| **P3 — input/sync** | hardware (32), packet (14), build/target preview hooks | a key/mouse trigger registered by a map fires; a sync trigger fires locally; window size/FPS answers | 2–3 d |
| **P4 — world extras** | unit/ability (28), items (5), orders (17), doodads (22), map/env (5), other (16) | per-pack synthetic tests; the JASS demo maps (with an install) exercise the names | 4–6 d |
| **P5 — platform** | 35 `DzAPI_Map_*` + 4 `RequestExtra*` | documented defaults; optional per-profile local save/load; never blocks a match | 1–2 d |
| **P6 — tail** | XLSX (9); process-memory/window no-ops documented | XLSX reads a fixture; every remaining name has an explicit answer | 1–2 d |

Total: roughly **13–22 developer-days**. P0+P1 is the highest value per day and makes every
one of the 394 names callable without crashing, which is the state `yd_jass_api` is in now.

---

## 5. Implementation structure

```
src/compat/dzapi/                 (or src/compat/lua/japi/dzapi/)
  decl.ts            generated 394 rows, grouped by source module
  registry.ts        registerDzNative(rt, decl, impl?) — native + signature tables
  values.ts          strings, bits, groups
  texttags.ts
  frames/
    core.ts          create/find/destroy/layout/appearance
    events.ts        scripts, triggers, engine-frame ids
    model.ts         model frames, simple-message frames, conversions
  input.ts           hardware + trigger registrations
  sync.ts            DzSync*/app events
  world/
    unit.ts          unit DB, model/texture/id, flags
    ability.ts       find/enable/string data
    item.ts
    orders.ts
    doodad.ts
    effect.ts
  platform.ts        DzAPI_Map_* + RequestExtra* policy
  misc.ts
  xlsx.ts            optional, last
```

The 394-row declaration table is generated, not hand-written. The generator belongs in
`tools/dzapi-scan.cjs` (parse `FUNC_ITEM`/`JASS_REGISTER_EX` into JSON), and a test asserts
the table and the source still agree — the same discipline used for JAPI signatures.

The frame pack extends `FrameObj` rather than duplicating it. Every new property must also be
read back by its getter, because the original's getter/setter pairs are symmetric and a map
uses them for state it cannot otherwise see.

---

## 6. Testing

1. **Declaration coverage**: all 394 names registered; each has a signature; calling one with
   a null/zero argument set answers its typed default and logs exactly once.
2. **Pure packs**: one synthetic test per function (strings/bits/orders/text tags).
3. **GUI**: the real UI demo map (`KKAPI_3/界面_ui模型lua测试`) must reach its model frame; a
   synthetic frame test covers create → point/size/text → event → destroy.
4. **Input/sync**: the existing `LuaInputBridge` fake and a fake match link.
5. **Platform**: assert the documented offline defaults, and that a local save/restore round
   trips if P5's local store is enabled.
6. **Regression**: `pnpm typecheck`, `pnpm jass:test` (needs an install), `pnpm lua:demo`
   (the five real Lua maps must stay green), and `node tools/map-compat.cjs --check`.

---

## 7. Risks and decisions to make

1. **`jass.japi` or natives?** DzAPI names are natives; `jass.japi` in the original does not
   list them. We should register them as natives and optionally alias them into `jass.japi`
   for `functiondef`/superset convenience. Decide once, in P0.
2. **Platform calls offline.** The defaults above are the only honest answer; a local profile
   store for server values is optional and must not be presented as the platform.
3. **Frames.** The tempting shortcut is a second frame system for DzFrame*. Do not: the map
   already draws through `ScriptFrameOverlay`, and two models would disagree on parent/anchors.
4. **Doodads/unit models.** These are per-map overrides. Cloning into `UnitRegistry.custom`
   and a runtime doodad table keeps one match's edits out of the next.
5. **XLSX** adds a zip/XML path with no match value; it is deliberately last.
6. **Memory/window functions** are not emulated; returning 0/no-op with a log is the honest
   degradation, not a stub that pretends to work.

---

## Appendix A — source module counts

| module | names |
|---|---:|
| `war3japi_gui.cpp` | 126 |
| `war3japi_plus.cpp` | 113 |
| `war3japi_extend.cpp` | 59 |
| `war3japi.cpp` | 40 |
| `war3japi_hardware.cpp` | 32 |
| `war3japi_packet.cpp` | 14 |
| `war3japi_db.cpp` | 10 |
| **total** | **394** |

## Appendix B — full name list by category

### GUI / frames (126)
`DzClickFrame, DzConvertScreenPositionX, DzConvertScreenPositionY, DzConvertWorldPosition,
DzConvertWorldPositionDepth, DzConvertWorldPositionX, DzConvertWorldPositionY,
DzCreateCommandButton, DzCreateFrame, DzCreateFrameByTagName, DzCreateSimpleFrame,
DzDestroyFrame, DzEnableWideScreen, DzFrameAddText, DzFrameCageMouse, DzFrameClearAllPoints,
DzFrameEditBlackBorders, DzFrameEnableClipRect, DzFrameFindByName, DzFrameGetAlpha,
DzFrameGetChatMessage, DzFrameGetChild, DzFrameGetChildrenCount, DzFrameGetCommandBarButton,
DzFrameGetCommandBarButtonAutoCastIndicator, DzFrameGetCommandBarButtonCooldownIndicator,
DzFrameGetCommandBarButtonNumberOverlay, DzFrameGetCommandBarButtonNumberText,
DzFrameGetEnable, DzFrameGetHeight, DzFrameGetHeroBarButton, DzFrameGetHeroHPBar,
DzFrameGetHeroManaBar, DzFrameGetInfoPanelBuffButton, DzFrameGetInfoPanelSelectButton,
DzFrameGetItemBarButton, DzFrameGetMinimap, DzFrameGetMinimapButton, DzFrameGetName,
DzFrameGetParent, DzFrameGetPeonBar, DzFrameGetPointRelative,
DzFrameGetPointRelativePoint, DzFrameGetPointValid, DzFrameGetPointX, DzFrameGetPointY,
DzFrameGetPortrait, DzFrameGetPriority, DzFrameGetText, DzFrameGetTextSizeLimit,
DzFrameGetTooltip, DzFrameGetTopMessage, DzFrameGetTriggerHpBar,
DzFrameGetTriggerHpBarUnit, DzFrameGetUnitHpBar, DzFrameGetUnitMessage,
DzFrameGetUpperButtonBarButton, DzFrameGetValue, DzFrameGetWidth, DzFrameGetWorldFrameMessage,
DzFrameHideInterface, DzFrameHookHpBar, DzFrameIsVisible, DzFrameSetAbsolutePoint,
DzFrameSetAllPoints, DzFrameSetAlpha, DzFrameSetAnimate, DzFrameSetAnimateByIndex,
DzFrameSetAnimateOffset, DzFrameSetCheckClip, DzFrameSetClip, DzFrameSetDisabledText,
DzFrameSetEnable, DzFrameSetFocus, DzFrameSetFont, DzFrameSetHighlightText,
DzFrameSetMinMaxValue, DzFrameSetModel, DzFrameSetParent, DzFrameSetPoint,
DzFrameSetPriority, DzFrameSetScale, DzFrameSetScript, DzFrameSetScriptAsync,
DzFrameSetScriptBlock, DzFrameSetScriptBlockAsync, DzFrameSetScriptByCode,
DzFrameSetScriptByCodeAsync, DzFrameSetSize, DzFrameSetStepValue, DzFrameSetTexCoord,
DzFrameSetText, DzFrameSetTextAlignment, DzFrameSetTextColor, DzFrameSetTextSizeLimit,
DzFrameSetTexture, DzFrameSetTooltip, DzFrameSetUpdateCallback,
DzFrameSetUpdateCallbackByCode, DzFrameSetValue, DzFrameSetVertexColor, DzFrameShow,
DzFrameWorldToMinimapPosX, DzFrameWorldToMinimapPosY, DzGetColor,
DzGetConvertWorldPositionX, DzGetConvertWorldPositionY, DzGetCursorFrame, DzGetGameUI,
DzGetMouseFocus, DzGetSimpleUIParent, DzGetTriggerUIEventFrame, DzGetTriggerUIEventPlayer,
DzIsChatBoxOpen, DzLoadToc, DzOriginalUIAutoResetPoint, DzSetCustomFovFix,
DzSimpleFontStringFindByName, DzSimpleFrameFindByName, DzSimpleFrameIsVisible,
DzSimpleFrameRemoveFromRegistry, DzSimpleFrameShow, DzSimpleMessageFrameAddMessage,
DzSimpleMessageFrameClear, DzSimpleTextureFindByName, DzTest`

### Platform map / request (39)
`DzAPI_Map_ChangeStoreItemCoolDown, …ChangeStoreItemCount, …GetActivityData,
…GetGameStartTime, …GetGuildName, …GetGuildRole, …GetLadderLevel, …GetLadderRank,
…GetMapConfig, …GetMapLevel, …GetMapLevelRank, …GetMatchType, …GetPlatformVIP,
…GetPublicArchive, …GetServerArchiveDrop, …GetServerArchiveEquip, …GetServerValue,
…GetServerValueErrorCode, …GetUserID, …HasMallItem, …IsBlueVIP, …IsRPGLadder, …IsRPGLobby,
…IsRedVIP, …Ladder_SetPlayerStat, …Ladder_SetStat, …MissionComplete, …OrpgTrigger,
…SavePublicArchive, …SaveServerValue, …Stat_SetStat, …Statistics, …ToggleStore,
…UpdatePlayerHero, …UseConsumablesItem; RequestExtraBooleanData, …IntegerData, …RealData,
…StringData`

### Hardware / input (32)
`DzChangeWindowSize, DzGetClientHeight, DzGetClientWidth, DzGetMouseTerrainX,
DzGetMouseTerrainY, DzGetMouseTerrainZ, DzGetMouseX, DzGetMouseXRelative, DzGetMouseY,
DzGetMouseYRelative, DzGetTriggerKey, DzGetTriggerKeyPlayer, DzGetWheelDelta,
DzGetWindowHeight, DzGetWindowWidth, DzGetWindowX, DzGetWindowY, DzIsKeyDown,
DzIsMouseOverUI, DzIsWindowActive, DzIsWindowMode, DzSetMousePos, DzTriggerRegisterKeyEvent,
DzTriggerRegisterKeyEventByCode, DzTriggerRegisterMouseEvent,
DzTriggerRegisterMouseEventByCode, DzTriggerRegisterMouseMoveEvent,
DzTriggerRegisterMouseMoveEventByCode, DzTriggerRegisterMouseWheelEvent,
DzTriggerRegisterMouseWheelEventByCode, DzTriggerRegisterWindowResizeEvent,
DzTriggerRegisterWindowResizeEventByCode`

### Unit / ability (28)
`DzAbilitySetEnable, DzAbilitySetStringData, DzAttackAbilityEndCooldown, DzGetAttackAbility,
DzGetUnitNeededXP, DzGetUnitUnderMouse, DzReviveUnit, DzSetUnitDataCacheInteger,
DzSetUnitDataCacheReal, DzSetUnitID, DzSetUnitModel, DzSetUnitPosition,
DzSetUnitTexture, DzUnitChangeAlpha, DzUnitCreateIllusion, DzUnitCreateIllusionFromUnit,
DzUnitDisableAttack, DzUnitDisableInventory, DzUnitFindAbility, DzUnitGetLevel,
DzUnitIsShowingHpBar, DzUnitOverheadOffset, DzUnitSetCanSelect, DzUnitSetMoveType,
DzUnitSetTargetable, DzUnitSilence, DzUnitUIAddLevelArrayInteger,
DzUnitUIClearLevelArrayInteger`

### Doodads (22)
`DzDoodadCreate, DzDoodadGetAddress, DzDoodadGetAnimationCount, DzDoodadGetAnimationName,
DzDoodadGetAnimationTime, DzDoodadGetCurrentAnimationIndex, DzDoodadGetTimeScale,
DzDoodadGetTypeId, DzDoodadGetX, DzDoodadGetY, DzDoodadGetZ, DzDoodadRemove,
DzDoodadSetAnimation, DzDoodadSetColor, DzDoodadSetModel, DzDoodadSetOrientMatrixResize,
DzDoodadSetOrientMatrixRotate, DzDoodadSetOrientMatrixScale, DzDoodadSetPosition,
DzDoodadSetTeamColor, DzDoodadSetTimeScale, DzDoodadSetVisible`

### System / misc (21)
`DzBlockSelectModeCommand, DzClearJassStringNotReference, DzDebugString, DzGetCodeName,
DzGetFPS, DzGetJassStringTableCount, DzGetLocale, DzGetMapFilePath, DzGetMemoryCache,
DzModelRemoveAllFromCache, DzModelRemoveFromCache, DzOpenQQGroupUrl, DzSaveMemoryCache,
DzSetClipboard, DzSetMaxFPS, DzSetMemory, DzSetSpeed, DzToggleFPS, DzUnlockBlpSizeLimit,
DzUnlockOpCodeLimit, DzWriteLog`

### Orders (17)
`DzQueueGroupImmediateOrderById, DzQueueGroupPointOrderById, DzQueueGroupTargetOrderById,
DzQueueIssueBuildOrderById, DzQueueIssueImmediateOrderById,
DzQueueIssueInstantPointOrderById, DzQueueIssueInstantTargetOrderById,
DzQueueIssueNeutralImmediateOrderById, DzQueueIssueNeutralPointOrderById,
DzQueueIssueNeutralTargetOrderById, DzQueueIssuePointOrderById, DzQueueIssueTargetOrderById,
DzUnitOrdersClear, DzUnitOrdersCount, DzUnitOrdersExec, DzUnitOrdersForceStop,
DzUnitOrdersReverse`

### Other (16)
`DzDestructablePosition, DzExecuteFunc, DzGetActivePatron, DzGetItemAbility,
DzGetOnBuildAgent, DzGetOnBuildOrderId, DzGetOnBuildOrderType, DzGetOnTargetAbilId,
DzGetOnTargetAgent, DzGetOnTargetInstantTarget, DzGetOnTargetOrderId,
DzGetOnTargetOrderType, DzRegisterOnBuildLocal, DzRegisterOnTargetLocal,
DzSetBuildAbilityModelCurrent, DzSetWidgetSpriteScale`

### Sync / packet (14)
`DzGetAppEventCommitKey, DzGetAppEventEventKey, DzGetAppEventEventValue, DzGetAppEventMapId,
DzGetAppEventMenuKey, DzGetAppEventType, DzGetTriggerSyncData, DzGetTriggerSyncPlayer,
DzGetTriggerSyncPrefix, DzSendAppCommit, DzSyncBuffer, DzSyncData,
DzSyncDataImmediately, DzTriggerRegisterSyncData`

### Effect (13)
`DzBindEffect, DzGetEffectVertexAlpha, DzGetEffectVertexColor, DzPlayEffectAnimation,
DzSetEffectAnimation, DzSetEffectModel, DzSetEffectPos, DzSetEffectScale,
DzSetEffectTeamColor, DzSetEffectVertexAlpha, DzSetEffectVertexColor, DzSetEffectVisible,
DzUnbindEffect`

### Strings (12)
`DzStringContains, DzStringFind, DzStringFindFirstNotOf, DzStringFindFirstOf,
DzStringFindLastNotOf, DzStringFindLastOf, DzStringInsert, DzStringReplace,
DzStringReverse, DzStringTrim, DzStringTrimLeft, DzStringTrimRight`

### Bit (11)
`DzBitAnd, DzBitGet, DzBitGetByte, DzBitNot, DzBitOr, DzBitSet, DzBitSetByte,
DzBitShiftLeft, DzBitShiftRight, DzBitToInt, DzBitXor`

### Unit DB (10)
`DzSetUnitCollisionSize, DzSetUnitDescription, DzSetUnitMissileArc, DzSetUnitMissileHoming,
DzSetUnitMissileModel, DzSetUnitMissileSpeed, DzSetUnitName, DzSetUnitPortrait,
DzSetUnitPreselectUIVisible, DzSetUnitProperName`

### XLSX (9)
`DzXlsxClose, DzXlsxOpen, DzXlsxWorksheetGetCellBoolean, DzXlsxWorksheetGetCellFloat,
DzXlsxWorksheetGetCellInteger, DzXlsxWorksheetGetCellString, DzXlsxWorksheetGetCellType,
DzXlsxWorksheetGetColumnCount, DzXlsxWorksheetGetRowCount`

### Text tags (6)
`DzTextTagGetFont, DzTextTagGetShadowColor, DzTextTagGetStartAlpha, DzTextTagSetFont,
DzTextTagSetShadowColor, DzTextTagSetStartAlpha`

### Map / environment (5)
`DzChangeTerrain, DzSetMiscCustomFoodCeiling, DzSetMiscCustomUpkeepUsage, DzSetWar3MapMap,
DzUpdateMinimap`

### Selection / minimap (5)
`DzGetLocalSelectUnit, DzGetLocalSelectUnitCount, DzGetSelectedLeaderUnit,
DzWidgetSetMinimapIcon, DzWidgetSetMinimapIconEnable`

### Items (5)
`DzItemResetColor, DzItemSetAlpha, DzItemSetModel, DzItemSetPortrait, DzItemSetVertexColor`

### Groups (2)
`DzGroupGetCount, DzGroupGetUnitAt`

### Player / tech (1)
`DzRemovePlayerTechResearched`
