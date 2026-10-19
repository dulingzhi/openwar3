# Cheats — `InstallCheats`, the classic codes, and how OpenWar3 carries them

This document is the port plan and the reverse-engineering record for Warcraft III's cheat
system. The authority is the 1.30.4 `Game.dll` (image base `0x6F000000`) and the install's own
`Units\Telemetry.txt`; every table below was read from those, not from a wiki.

Two source files implement it:

- [`src/sim/cheats.ts`](../src/sim/cheats.ts) — `CheatState`, the twelve bits of `CCheatData+4`.
- [`src/game/cheats.ts`](../src/game/cheats.ts) — the command table, parser and `CheatHost`.

The simulation asks the dword where the original asks its own; the scene types the words in.
Nothing here is reachable in a networked match (see [§7](#7-single-player-only)).

---

## 1. The original: what `InstallCheats` does

`?InstallCheats@@YIXXZ` — **`0x6F379E10`**, 158 bytes. Its whole body:

1. allocate one `CCheatData` (8 bytes: a vtable, then the flags dword at `+4`) and hang it on
   the application object;
2. call twenty `Register*` helpers.

| # | Register | Address | Command id | `Recv*` handler | Telemetry key |
|---|---|---|---|---|---|
| 1 | `RegisterFastbuild` | `0x6F37AA40` | `0x23` | `RecvFastbuild` `0x6F37A210` | `a` |
| 2 | `RegisterFastdeath` | `0x6F37AA80` | `0x24` | `RecvFastdeath` `0x6F37A270` | `b` |
| 3 | `RegisterFood` | `0x6F37AAC0` | `0x25` | `RecvFood` `0x6F37A2E0` | `g` |
| 4 | `RegisterGod` | `0x6F37AB00` | `0x26` | `RecvGod` `0x6F37A360` | `c` |
| 5 | `RegisterGold` | `0x6F37AB40` | `0x27` | `RecvGold` `0x6F37A3D0` | `d` |
| 6 | `RegisterLevelJump` | `0x6F37ABB0` | — | `LevelJump` `0x6F379EB0` | `s` |
| 7 | `RegisterLumber` | `0x6F37AC10` | `0x28` | `RecvLumber` `0x6F37A440` | `e` |
| 8 | `RegisterMana` | `0x6F37AC80` | `0x29` | `RecvMana` `0x6F37A4B0` | `h` |
| 9 | `RegisterMaxFPS` | `0x6F37ACC0` | — | `MaxFPS` `0x6F37A070` | *(literal `maxfps`)* |
| 10 | `RegisterNoVictory` | `0x6F37AD00` | `0x2A`/`0x2B` | `RecvNoDefeat` `0x6F37A530`, `RecvNoVictory` `0x6F37A5A0` | `j`, `k` |
| 11 | `RegisterCooldown` | `0x6F37A9E0` | `0x20` | `RecvCooldown` `0x6F37A0C0` | `i` |
| 12 | `RegisterCritterExplode` | `0x6F37AA20` | `0x21` | `RecvCritterExplode` `0x6F37A130` | *(none)* |
| 13 | `RegisterResearch` | `0x6F37AD90` | `0x2C` | `RecvResearch` `0x6F37A610` | `l` |
| 14 | `RegisterResources` | `0x6F37ADD0` | `0x2D` | `RecvResources` `0x6F37A6A0` | `f` |
| 15 | `RegisterShowMap` | `0x6F37AE40` | `0x2F` | `RecvShowMap` `0x6F37A730` | `m` |
| 16 | `RegisterSong` | `0x6F37AE80` | — | `SetSong` `0x6F37BA60` | `v` |
| 17 | `RegisterTechTree` | `0x6F37AEB0` | `0x30` | `RecvTechTree` `0x6F37A800` | `n` |
| 18 | `RegisterTimeOfDay` | `0x6F37AEF0` | `0x2E` | `RecvTod` `0x6F37A880` | `o`,`p`,`q` |
| 19 | `RegisterUpgrade` | `0x6F37AFC0` | `0x31` | `RecvUpgrade` `0x6F37A960` | `r` |
| 20 | `RegisterVictory` | `0x6F37B000` | `0x22`/`0x32` | `RecvDefeat` `0x6F37A1D0`, `RecvVictory` `0x6F37A9A0` | `t`,`u` |

The registration order is the order `InstallCheats` calls them, and it is also the
`[Telemetry]` key order a…v — which is what makes the key→word mapping below reconstructible.

### 1.1 The command NAME is a hash, not a literal

`ScrnConsoleRegisterFunction` has two overloads:

- `0x6F197C00` takes a **string** (used only by `maxfps`) and stores `SStrHash64(text, 0, 0)`.
- `0x6F197C40` takes the **pre-computed 64-bit value** the `Register*` helpers read out of
  `Units\Telemetry.txt`.

So the game ships no cheat words in the binary. `Units\Telemetry.txt` is a small INI:

```ini
[Telemetry]
a=-6968993115968202010
b=-3304013799902092087
…
```

### 1.2 Typing one

`CGameUI::OnChatSend` (`0x6F36F060`) is the player door, and its first test is the rule:

```c
if ( !Text || !*Text || !NetIsMultiPlayer() && ScrnConsoleProcessCommandString(Text, 1)
     || CGameUI::ProcessLocalChatCommand(...) ) goto done;
```

**Single player only.** `ProcessCommand` (`0x6F197150`):

1. `=` repeats `s_lastCommand`;
2. tokenise on `" ,;()\"\t"` (`SStrTokenize`);
3. `SStrHash64(token, 0, 0)` → look up `s_commandTable`;
4. an unknown hash prints `"Invalid command %s."` and does nothing;
5. parse the remaining tokens into the registered parameter list (defaults on omission);
6. call the handler, then remember the line.

`SStrHash64` lives in `Storm.dll` at `0x1503A780` (image base `0x15000000`); the 16-entry
`uint64` table is at `0x15043F28`. It upper-cases `a`–`z`, folds `/` to `\`, and hashes:

```
V = 0x7FED7FED7FED7FED ; A = 0xEEEEEEEEEEEEEEEE
for each char c:
    V = (V + A) XOR (table[c >> 4] + table[c & 15])
    A = V + A + (A << 5) + c + 3        (all 64-bit, wrapping)
return V == 0 ? 1 : V
```

That is what makes every cheat **case-insensitive**, and why the port matches words
case-insensitively rather than reproducing the hash table.

### 1.3 The dword

`CCheatData` is `{ vftable, flags }`; every toggle is one bit at `+4`. `CheatEnabled(flag)`
(`0x6F1F8C00`) ANDs the argument with it, and the gameplay code inlines the same test.

| bit | word | owner |
|---|---|---|
| `0x001` | `thedudeabides` | `RecvCooldown` |
| `0x002` | `whosyourdaddy` | `RecvGod` |
| `0x004` | `warpten` | `RecvFastbuild` |
| `0x008` | `iocainepowder` | `RecvFastdeath` |
| `0x010` | `pointbreak` | `RecvFood` |
| `0x020` | `thereisnospoon` | `RecvMana` |
| `0x040` | `strengthandhonor` | `RecvNoDefeat` |
| `0x080` | `itvexesme` | `RecvNoVictory` |
| `0x100` | `whoisjohngalt` | `RecvResearch` |
| `0x200` | `iseedeadpeople` | `RecvShowMap` |
| `0x400` | `synergy` | `RecvTechTree` |
| `0x800` | `daylightsavings -1` | `RecvTod` |

`CheatSet(flag, enable)` (`0x6F29EEA0`) is the engine's own setter; `CTestGameSetup::ApplyCheats`
uses it to force no-victory/no-defeat in a test game, and `CMinimap::UpdateUnits` uses it to
reveal the map after 612 consecutive desync frames. It is not a JASS native.

---

## 2. The full cheat table

The words below are the install's. The **hash** column is `Units\Telemetry.txt` verbatim (a…u;
`v` is the unrecovered song command — see §5.2). Parameters and defaults are the arguments to
`ScrnConsoleRegisterFunction`.

| Key | Word | Hash | Handler effect | Params (default) |
|---|---|---|---|---|
| a | `warpten` | `-6968993115968202010` | Build/train/research ×16; re-rates live jobs | — |
| b | `iocainepowder` | `-3304013799902092087` | Corpse / hero-body decay ÷16 | — |
| c | `whosyourdaddy` | `-930154931662156553` | God mode by controller; ×100 blows | — |
| d | `keysersoze` | `-8008807713700409405` | Add gold | `<amount=500> <player=-1>` |
| e | `leafittome` | `-872748036714025544` | Add lumber | `<amount=500> <player=-1>` |
| f | `greedisgood` | `2354477290916240923` | Add gold **and** lumber | `<amount=500> <player=-1>` |
| g | `pointbreak` | `793747866433114248` | Supply cap stops refusing | — |
| h | `thereisnospoon` | `-7984411119628152567` | Mana never short / never spent | — |
| i | `thedudeabides` | `-1232246075420074842` | On enable: clear every cooldown in the world | — |
| j | `strengthandhonor` | `8514950617083462119` | No defeat (`IsNoDefeatCheat`) | — |
| k | `itvexesme` | `-3879491486085606535` | No victory (`IsNoVictoryCheat`) | — |
| l | `whoisjohngalt` | `-5801382533913064927` | Abilities/hero skills ignore research prerequisites | — |
| m | `iseedeadpeople` | `8079072272279897596` | Fog + fog mask off, local machine | — |
| n | `synergy` | `-446920761596970885` | Units/upgrades/morphs/shop units ignore requirements | — |
| o | `riseandshine` | `4192987606572922140` | Set clock to `[Misc] Dawn` | — |
| p | `lightsout` | `-6123244557153587235` | Set clock to `[Misc] Dusk` | — |
| q | `daylightsavings` | `2831672247888008556` | Set the clock; `-1` toggles the halt | `<hour=-1.0>` |
| r | `sharpandshiny` | `-2382913011035714490` | +1 level to every upgrade, players 0–11 | — |
| s | `motherland` | `-6170793653628190315` | Campaign: open missions and ChangeLevel | `<campaign=human> <level=1>` |
| t | `somebodysetusupthebomb` | `6169467044321463317` | Declare the local player defeated | — |
| u | `allyourbasearebelongtous` | `-1019274656927319569` | Declare the local player victorious | — |
| — | `maxfps` | *(literal string)* | Set `PREF_VIDEO_MAXFPS` live | `<fps=200>` |
| v | *(unrecovered)* | `-8998525607538777175` | `SetSong`: play `Sound\Music\mp3Music\PH1.mp3` | — |

The one-shot `RecvGold`/`RecvLumber`/`RecvResources` handlers treat `player == 0xFF` as
"enumerate every playable slot" (`CGameWar3::EnumeratePlayers(..., onlyPlayableSlots: 1)`) and
otherwise add to the named slot with **no upkeep and no divert tax**. `RecvUpgrade` loops
`playerId = 0 … 11`, not only the playable seats.

---

## 3. Per-cheat behaviour (what the port must reproduce)

### 3.1 `whosyourdaddy` — God mode is a CONTROLLER rule, not an owner rule

`CUnit::TakeDamage` (`0x6F69B600`) holds the whole of it:

```c
if (cheat->flags & 2 && damage->source) {
    srcController = GetPlayer(damage->source)->m_controller;  // MAP_CONTROL_USER = 0
    tgtController = GetPlayer(target)->m_controller;
    if (srcController != USER && tgtController == USER) dmg = 0;              // computer -> user
    else if (srcController == USER && tgtController != USER) dmg = original * 100;
}
```

`original` is `originalAmount`, the blow BEFORE armour and the damage table, and `u_100` is the
literal 100. Two consequences the port keeps:

- a user is protected **only** from non-user sources (computer, creep, neutral);
- a user's blow is ×100, not literally a one-hit kill — a 10 000 HP target survives one.

Paths that bypass our `landDamage` (Devour's digest, Spirit Link's share, a shield's tick) ask
the same question through `SimWorld.godBlocks`.

### 3.2 `warpten` — ×16, everywhere a rate is asked

`CUnit::BuildRate` (`0x6F66BFC0`) returns `1 × u_16` (16) while the bit is on;
`UnitApplyBuildRateChange` (`0x6F64FAD0`) re-rates every live `CAbilityBaseBuild`. The port's
`SimWorld.fastBuild` is now a view of this bit, and construction/training/research compress as
before.

### 3.3 `iocainepowder` — ÷16 decay

`CUnit::TaskDecay` (`0x6F69C280`) and `TaskDecayBone` (`0x6F69C390`) divide the configured
`DecayTime` / `BoneDecayTime` by 16. The port applies the same division to the corpse's
`decayLeft` and to a hero's `bodyLeft`.

### 3.4 `pointbreak` — the supply cap stops refusing

`CPlayerWar3::HasFoodCapRoom` (`0x6F2668B0`) returns true before it reads either number. The
readout still shows the real food. In the port this is the `Authority.foodRoom` hook plus the
two direct training/building checks; the numbers on screen are untouched.

### 3.5 `thereisnospoon` — no mana cost, no mana drain

`CUnit::EnoughMana` (`0x6F67E420`) returns 1; `CUnit::SpendMana` (`0x6F69A2F0`) takes nothing.
`CBuffManaDrain::ApplyManaCheat` and `CBuffImmolation::ApplyManaCheat` remove the negative
regen/drain modifiers. The port's `enoughMana` / `spendMana` guard every cast and per-shot orb
cost, and the Immolation and Siphon Mana drains skip their negative legs.

### 3.6 `thedudeabides` — a ONE-SHOT, not an ongoing immunity

`UnitApplyCooldownCheat` (`0x6F64FAF0`) enumerates every `CAbilitySpell` in the world
(`descendants: 1`) and kills its `m_cooldown_timer`. There is no later check of the bit: a
spell cast after the press goes on cooldown normally. The port's `clearAllCooldowns` does the
same, item abilities included, and only when the toggle turns ON.

### 3.7 `whoisjohngalt` vs `synergy` — two different requirement switches

| bit | consumer | covers |
|---|---|---|
| `0x100` research | `CAbility::HasDep` `0x6F419A30`, `CAbilityHero::HasDep` `0x6F528F50` | **abilities and hero skills** |
| `0x400` tech tree | `CAbilityBaseBuild::HasDep` `0x6F419B60`, `CAbilityQueue::HasDep` `0x6F419BF0`, `CAbilityResearch::HasDep` `0x6F419D10`, `CAbilitySellUnit::HasDep` `0x6F419DA0`, `CAbilityTrain::HasDep` `0x6F59BCF0`, `CAbilityMorph::HasDep` `0x6F55C450` | units, upgrades, morphs, shop units |

The port's `SimWorld.techMeets` decides by id kind: an ability-registry row asks the research
bit, everything else asks the tech-tree bit. `World.canMake`, the upgrade queue, the shop and
the command card ask the tech-tree bit.

### 3.8 `sharpandshiny` — one level of everything, for every slot

`CPlayerUpgrade::IncrementUpgrades` (`0x6F6C9FF0`) walks the upgrade database backwards, takes
the row's FIRST `effect` id, skips the engine-internal ids whose first character is `_` (95)
or `-` (45), increments that player's level and calls `AddTech`. It runs for player ids 0–11.
The port's `Authority.cheatIncrementUpgrades` does the same, clamped to each row's `maxLevel`.

### 3.9 `iseedeadpeople` — fog OFF, not the simulation's knowledge

`RecvShowMap` toggles `CFogOfWarMap::EnableMask`/`EnableFog` with `clear: 1`, calls
`WorldSetFogDisplay` and resets the cursor. `CUnit::CanSee*` also ORs the bit into its
visibility mask. This is a DISPLAY and TARGETING override for the local machine, and the port
maps it to `RtsController.setLocalRevealAll` — never the whole match's lobby fog mode, which
would hand the computers the same eyes (the same distinction `iseedeadpeople` and observers
already had in `rts.ts`).

### 3.10 `riseandshine`, `lightsout`, `daylightsavings`

`SendDawn`/`SendDusk` read `[Misc] Dawn` / `[Misc] Dusk` from `UI\MiscData.txt` and call
`TimeOfDaySet`. `RecvTod` with `time == -1.0` toggles `TimeOfDayHaltTime(haltTOD_Script)` and
`ResumeTime`; any other value sets the clock. The halt is a separate OWNER from the script's
`SuspendTimeOfDay`, which is why the port has its own bit rather than reusing
`timeOfDaySuspended`.

### 3.11 `motherland` — a campaign jump, not a melee command

`CGameWar3::LevelJump` (`0x6F379EB0`) refuses when `NetIsMultiPlayer()` or
`m_isCampaignMission == 0`. It then:

1. `GetCampaignIndex(campaignName)` on the active profile;
2. mark that campaign available, first mission auto-launch off;
3. read `CampaignFile_V<n>`'s `Mission<level-1>` (level is 1-based; `0` means the first);
4. mark missions `level-1 … 0` available;
5. `RequestChangeLevel(mapName, no scores)`.

The port splits this between `campaignProgress.unlockThrough` (availability) and `main.ts`'s
existing `changeLevel` (the load). It only runs when the match is a campaign mission.

### 3.12 `somebodysetusupthebomb` and `allyourbasearebelongtous`

`RecvDefeat`/`RecvVictory` call `CPlayerWar3::DispatchPlayerDefeat` / `::DispatchPlayerVictory`
for the sender. That raises the player event — common.j's `EVENT_PLAYER_DEFEAT = 13`,
`EVENT_PLAYER_VICTORY = 14`. blizzard.j listens to DEFEAT (`MeleeTriggerActionPlayerDefeated`)
and its `RemovePlayerPreserveUnitsBJ` → `AllowVictoryDefeat` is where the no-defeat/no-victory
bits actually act:

```jass
function AllowVictoryDefeat takes playergameresult gameResult returns boolean
    if gameResult == PLAYER_GAME_RESULT_VICTORY then
        return (not IsNoVictoryCheat())
    elseif gameResult == PLAYER_GAME_RESULT_DEFEAT then
        return (not IsNoDefeatCheat())
    endif
    return true
endfunction
```

The port fires the same events and records the same `RemovePlayer` result; the victory screen
is built by the same `MeleeVictoryDialogBJ` shape when no map trigger raised one first.

### 3.13 `maxfps`

`RegisterMaxFPS` (`0x6F37ACC0`) is the only registration that passes a literal string
(`"maxfps"`) rather than a Telemetry hash. `MaxFPS` sets `CPreferencesWar3` preference 22
(`PREF_VIDEO_MAXFPS`) and applies it. It never calls `CheatMessage`. In the port it drives
`src/render/frameCap.ts`'s runtime cap (`setMaxFps`, 0 = uncapped), which is a shell/runtime
setting in our engine rather than a stored preference.

### 3.14 `RegisterCritterExplode` — a net command with no console name

`RecvCritterExplode` (`0x6F37A130`) takes a presence tag from the event, resolves a unit whose
class id matches, and calls `NukeUnit(unit, dealDamage: 0)` — the unit is removed with its
explosion art, no damage credit. It is registered as a NET COMMAND (`0x21`) only; there is no
`ScrnConsoleRegisterFunction` call, so **no typed word reaches it**. The port records it in this
document and leaves it out of the command table rather than inventing a word.

---

## 4. What the port added

| File | Change |
|---|---|
| `src/sim/cheats.ts` | **new** — `CheatFlag`, `CheatState` (the twelve bits) |
| `src/game/cheats.ts` | **new** — `CHEAT_COMMANDS`, `parseCheat`, `runCheat`, `CheatHost` |
| `src/sim/world.ts` | `cheats` dword; god rule in `landDamage`; `enoughMana`/`spendMana`; food and tech gates; decay ÷16; clock halt; `clearAllCooldowns`; `fastBuild` is now a view |
| `src/game/rts.ts` | public `cheatAddGold`/`cheatAddLumber`/`cheatClearCooldowns`/`cheatIncrementUpgrades`/`cheatSetTimeOfDay`/`cheatHaltTimeOfDay`/`cheatSetRevealAll`; `cheat()` keys god/fastbuild off the dword |
| `src/game/authority.ts` | `foodRoom` and the two direct supply checks honour `pointbreak`; upgrade queue honours `synergy`; `cheatIncrementUpgrades` |
| `src/render/mapViewer.ts` | `typedCheat` now runs the table; `CheatHost` implementation; `=` repeat; `Cheat` / `IsNo*Cheat` hooks; `cheatEndGame`; `onCampaignJump` |
| `src/jass/natives/dialogs.ts` | `Cheat`, `IsNoVictoryCheat`, `IsNoDefeatCheat` are LIVE (were `false` literals) |
| `src/jass/runtime.ts` | `cheat`, `isNoVictoryCheat`, `isNoDefeatCheat` hooks |
| `src/render/frameCap.ts` | runtime `setMaxFps` (the console's `maxfps`) |
| `src/data/campaignProgress.ts` | `unlockThrough` — open missions without completing them |
| `src/main.ts` | `jumpCampaign` + `onCampaignJump` wiring |
| `tools/sim-cheats-test.cjs` | headless checks (bits, table, parser, god, mana, cooldown, decay, clock) |

### 4.1 Data flow

```
chat line ──► MapViewerScene.sendChat ──► typedCheat ──► runCheat(CheatHost, line)
                                                     │
                              ┌──────────────────────┴─────────────────────┐
                              ▼                                            ▼
                     sim.cheats (the dword)                     controller/scene doors
                     god / mana / food / tech / decay           gold, upgrades, cooldown,
                     / clock halt / no-defeat / no-victory      fog, TOD, campaign, victory,
                                                                song, maxfps, message
```

`SimWorld` is still the only place a simulation rule lives; the command table never reaches
into a renderer or the DOM. The host is the scene because fog, the campaign index, the sound
board and the victory dialog are the scene's (or `main.ts`'s), exactly as they were before.

### 4.2 The `Cheat` native

`common.j` exposes `native Cheat takes string cheatStr returns nothing`; the original hands
the string to the same console processor. The port wires it to `typedCheat`, so a map can call
`Cheat("greedisgood 1000")`. It is subject to the same single-player gate — a map cannot use it
to desync a LAN game.

---

## 5. Deviations, and what is not implemented

### 5.1 The net-command half

The original sends every cheat as a `CNetCommandCheat*` and computes it into the lockstep
checksum (`CCheatData::CheckSum`). Our cheats are single-player only and the dword lives on
the sim, so there is no wire format. This is a deliberate consequence of the gate in §7, not a
missing feature.

### 5.2 The song command (Telemetry `v`)

`RegisterSong` reads the hash `-8998525607538777175`; the handler is `SetSong`
(`0x6F37BA60`), which plays `Sound\Music\mp3Music\PH1.mp3` once. The install ships only the
hash, and a 64-bit preimage is not recoverable from the data. We hashed the game's own cheat
lists, the music/theme vocabulary and 370 000 English words; none matched. The port:

- implements the handler as `CheatHost.playSong` (the `playCheatSong` helper);
- does **not** register a typed word, because inventing one would be a fake cheat code.

The effect is reachable from the dev tools / a future UI, not from chat.

### 5.3 `RegisterCritterExplode`

See §3.14. No typed word exists in the original, so none is exposed.

### 5.4 Presentation details

- `CheatMessage` sets `CHEATENABLED`/`CHEATDISABLED` for ten seconds on the typing player
  (`CGameUI::SetCheatMessageText`). The port uses the same GlobalStrings keys through the
  HUD's message column. The ten-second lifetime is the HUD's own message lifetime.
- `CGameUI::Refresh` is called by several handlers; our HUD recomputes the command card and
  resource bar from live sim state every frame, so `refreshUi` is a no-op by construction.
- `maxfps` in the original is a stored preference; ours is a live runtime cap (and the shell
  already owns an initial one). The observable behaviour — the page refreshes no faster than
  N — is the same.

---

## 6. Verification

`tools/sim-cheats-test.cjs` (part of `pnpm sim:test`) pins:

- the twelve bit positions and the `CheatState` mask/toggle/reset;
- the word table order against Telemetry a…u and the absence of a fake song word;
- the parser's separators, defaults, case folding and refusal of bad numbers;
- `greedisgood`'s single-player and all-playable-slot forms;
- toggle messages vs one-shot messages vs `maxfps`'s silence;
- `thedudeabides` clearing exactly once, on enable;
- god's three cases (computer→user 0, user→computer ×100, computer→computer unchanged);
- `EnoughMana`/`SpendMana`, cooldown clearing (card + belt), fast build, ÷16 decay;
- the clock halt and its release;
- the networked refusal at `runCheat`.

Run it with:

```bash
pnpm sim:test                       # full suite (includes the file above)
node tools/sim-cheats-test.cjs      # this file alone, after tsc -p tools/tsconfig.sim.json
```

The in-game check is a single-player skirmish: type the words in chat (they are consumed, not
sent), watch `CHEATENABLED`, then verify the effect — `warpten` halves a Barracks timer,
`pointbreak` queues past the cap, `whoisjohngalt` lights a gated ability, `synergy` lights a
gated building, `thedudeabides` clears the card, `iseedeadpeople` lifts the fog for this
machine only.

---

## 7. Single-player only

`CGameUI::OnChatSend` feeds the console only when `!NetIsMultiPlayer()`. Our `RtsController`
refuses every cheat in a networked match at four independent doors:

1. `runCheat` returns null when `host.networked`;
2. every `RtsController.cheat*` method returns early on `this.networked`;
3. `MapViewerScene.cheatsAllowed` is false whenever a `MatchLink` exists;
4. the `Cheat` native goes through the same `typedCheat`.

A cheat mutates the authoritative sim (gold, tech, damage); in a lockstep game that is a
desync, and the original's own gate exists for the same reason. A map that calls `Cheat()` on
a LAN host therefore gets nothing — the safe reading of the original, where the net command
would at least be rejected by the other peers' console.
