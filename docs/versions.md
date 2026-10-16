# The two Warcraft III builds OpenWar3 plays (1.30.4 and 1.27)

OpenWar3 reads every unit, ability, cost and timing out of **the player's own install** — that is
the whole asset-compatible design (CLAUDE.md, "Prime directive"). It follows that two players on
different patches are two players playing different games: the authority resolves an order against
*its* Footman and a client draws the one in its own SLKs, and nothing downstream ever raises an
error about it.

So the build is a **gate** rather than a note (`src/vfs/version.ts`), checked on every launch and
not only when the folder is first picked, and the same label travels with a LAN room so a mixed
match is refused at the door (`src/net/protocol.ts` `RoomInfo.gameData`).

Two builds pass that gate.

| | 1.30.4 | 1.27 |
|---|---|---|
| storage | CASC content store (`Data/`) | four MPQ archives |
| says which build it is in | `.build.info` | `War3.exe`'s `VS_VERSION_INFO` resource |
| matched on | first **three** components (`1.30.4`) | first **two** (`1.27`) |
| data sets | live / `Melee_V0` / `Custom_V0` / `Custom_V1` | live paths only |
| later balance patches | applied (`src/patches/`) | **not** applied |

## Why 1.27 is the second one

It is the last widely used MPQ-era release, and the one a competitive scene and a decade of
platform clients still run. It is also the *only* second build worth supporting: 1.26 and 1.28
are the same storage but their data is neither what this engine was written against nor what
anyone still plays, so they are refused by name.

**Nothing about 1.27 was assumed compatible — it was measured.** Against the developer's retail
1.27 install:

- **All 92 `MiscGame.txt` and all 44 `MiscData.txt` rows** this engine transcribes
  (`src/data/gameplayConstants.ts`) are **identical**. The combat tables, XP curves, hero
  attributes and refunds do not move between these two builds.
- **21 of the 22 melee constants** in `Blizzard.j` are identical (`MELEE_STARTING_GOLD_V1` 500,
  `MELEE_HERO_LIMIT` 3, …).
- **`Melee_V0`/`Custom_V0`/`Custom_V1` do not exist**, which `EditionDataSource` already
  tolerated — an MPQ-era install reads the live tables throughout (`docs/editions.md`).
- **The four unit/ability tables differ**, as they should: those are the balance changes. They
  are read from the install at runtime, so a 1.27 match is a 1.27 match throughout.

## Reading the version out of an MPQ-era folder

An MPQ folder has no `.build.info` and never had one. The answer is where Windows applications
have always kept it: the `VS_VERSION_INFO` resource inside the game executable
([`src/vfs/peVersion.ts`](../src/vfs/peVersion.ts)).

**`War3.exe` and never `Warcraft III.exe`.** In this era the latter is the *launcher* — a 274 KB
stub whose own resource table reads `1.0.0.1` — and `War3.exe` is the game. Verified against the
retail install: it reports `1.27.0.52240`. Matching the name exactly is the whole of telling them
apart, and getting it wrong would make every 1.27 folder read as an unknown build.

Two details of the resource walk cost a round each and are worth knowing before touching it:

- **Resource directory offsets are relative to the root of the resource directory**, not to the
  containing directory. They look exactly like an ordinary relative pointer and are not, and
  resolving them against the parent walks into a sibling and reads a plausible-looking directory
  header out of unrelated bytes.
- **The third level is a leaf**, not another directory: its offset has the high bit *clear* and
  points at an `IMAGE_RESOURCE_DATA_ENTRY`.

The build's four 16-bit fields are read from the binary `VS_FIXEDFILEINFO` rather than from the
per-language string table, because the strings are keyed by a language id that varies with the
localized install. `tools/pe-version-test.mjs` (`pnpm pe:test`) builds a **synthetic** PE image to
pin all of this — OpenWar3 ships zero Blizzard bytes, so a committed `War3.exe` was never an
option, and the real file is only ever read from the player's disk at runtime.

## Where each surface learns which build it is

The shell cannot read a PE resource and does not try. It checks the folder's **shape** — the game
executable plus at least one archive (`electron/install.mjs` `looksLikeInstall`) — and the
renderer, which owns the only PE reader, says which build it is. A 1.26 folder is therefore
*accepted by the shell and refused by the game*, with the version named in the message; the
reverse (accepting a folder the game then mounts) is the failure that would actually hurt.

The same split appears twice more, both for the same reason:

- `tools/vite-plugin-dev-install.ts` serves the folder; `src/dev/devBoot.ts` fetches `War3.exe`
  through the same route every other byte comes through.
- `src/assets/nativeInstall.ts` fetches it over the desktop app's `ow3-install://` scheme.

`PickedInstall.version` (src/assets/opfs.ts) is the one field that carries it, and `checkVersion`
is the one function that reads it.

## The later balance patches do not apply to 1.27

`PatchDataSource` was already CASC-only (`src/vfs/loader.ts`), because every release in
`src/patches/data/` is stated against 1.30.4.

**But `MiscGame.txt` is compiled in**, out of the VFS's reach, and reads its patch edits through
`patchedMiscGame` — a path that never passed through the VFS at all. Left alone, a 1.27 melee
match quietly fought on 2.0.3's Piercing-vs-Heavy table. `patchesApply()` /`setPatchesApply`
(src/patches/index.ts) closes it, and `loadProfile` states the fact beside the version.

## A localized install's text is UTF-8

The developer's 1.27 folder is a Simplified-Chinese install, and its data files begin `EF BB BF`
— a **UTF-8 byte-order mark** — over valid UTF-8. Read as windows-1252, as this engine had read
every `*Strings.txt`/`*.fdf` since it was written, the main menu came out `å•äººæ¨¡å¼` where it
should read 单人模式.

Worse than the visible half: the BOM landed **inside the first key of the file**, so
`Units\CommandStrings.txt` opened with a section named `ï»¿[CmdMove]` — which matches nothing.

[`src/vfs/text.ts`](../src/vfs/text.ts) is the one decoder now, and its rule is the file's own
declaration rather than a guess: a BOM means UTF-8 (and is removed, not decoded), anything else
is read exactly as before. That cannot regress a file that used to read correctly — a BOM'd file
was already mojibake — and it is pinned by `tools/wc3-text-test.mjs` (`pnpm text:test`).

**It is not a general localization fix.** A Chinese or Russian install whose files carry *no* BOM
(GBK, CP1251) is still read as windows-1252 and still garbled, and there is no such install in
hand to measure a rule against. Inventing one would be guessing.

## Known, accepted differences on 1.27

- **Team colour textures past 15.** A 1.27 install ships `TeamColor00..15`; the viewer's own
  colour table asks for up to 27, so 48 fetches fail harmlessly on load. This is deliberate and
  pre-existing — the viewer patch already documents that `TeamColor16..27` have nothing to load —
  and only affects colours no 1.27 game can seat a player on. `neutralTeamColor` already asks the
  ART which table it is (`TeamColor24` exists?) rather than counting seats, so the neutral black
  swatch is correct on both builds.
- **The console is 1.30.4's.** `src/ui/consoleUi.ts` reproduces 1.30.4's held-4:3 console rather
  than the older client's stretched one; on a 1.27 install that is a deliberate choice, not a
  rendering fault.
- **`Units\MiscGame.txt` rows are the 1.30.4 ones**, which the measurement above says are also
  1.27's. If a third build is ever admitted, that equality has to be re-measured rather than
  assumed — it is the reason `pnpm data:verify` exists.
