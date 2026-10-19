// The cheat register — the COMMAND half.
//
// Warcraft III's `InstallCheats` (Game.dll 1.30.4, 0x6F379E10) registers twenty handlers and
// twenty console commands. The command NAME is not a literal in the binary: `Register*` reads
// a 64-bit value out of `Units\Telemetry.txt` (`[Telemetry] a=… b=…`) and hands it to
// `ScrnConsoleRegisterFunction`, which matches a typed token by `SStrHash64(token, 0, 0)`
// after upper-casing it and folding `/` to `\`. The file's values are one-way hashes, so the
// words below were recovered by hashing the game's own cheat list with Storm's algorithm and
// matching the values — 21 of the 22 keys (`a`..`u`) match exactly. Key `v`, the song
// command, does not match any candidate we could find and is therefore NOT exposed here; the
// install ships only its hash, and a 64-bit preimage is not recoverable from the data. The
// handler itself (`SetSong`, which plays `Sound\Music\mp3Music\PH1.mp3`) is ported and
// reachable from the dev tools (`playCheatSong`).
//
// Every other handler's behaviour is transcribed in the table below. Parameters, defaults and
// the toggle/one-shot distinction are the original `ScrnConsoleRegisterFunction` arguments;
// the bit each toggle owns is the `CCheatData+4` flag (src/sim/cheats.ts).
//
// Entry point is exactly the original's: in SINGLE PLAYER the chat box is given to the
// console first (`CGameUI::OnChatSend` → `ScrnConsoleProcessCommandString`), and a line that
// matches a command is consumed rather than sent as chat. `=` repeats the last command.
//
// Sources: Game.dll `?InstallCheats@@YIXXZ` and the `Register*`/`Recv*` pair for each row;
// `Units\Telemetry.txt` for the key→hash table; `ProcessCommand` (0x6F197150) for tokenising.

import { dataNum } from "../data/gameplayConstants";
import { CheatFlag, type CheatState } from "../sim/cheats";

/** `SStrHash64`'s first seed, 0x7FED7FED — recorded here because the command table in the
 *  original is keyed by the hash and not by the word (see the header). */
export const SSTRHASH64_SEED = 0x7FED7FED;

/** The song command (`RegisterSong`, Telemetry key `v`). The original plays this file. */
export const CHEAT_SONG_FILE = "Sound\\Music\\mp3Music\\PH1.mp3";

/** The parameter kinds `ScrnConsoleRegisterFunction` accepts and the cheat rows use. */
export type CheatParam =
  | { kind: "int"; default: number }
  | { kind: "float"; default: number }
  | { kind: "string"; default: string };

/** What a cheat command needs from the running match. Implemented by RtsController + the
 *  scene (render/mapViewer.ts); `game/cheats.ts` itself imports no renderer and no DOM. */
export interface CheatHost {
  readonly networked: boolean;
  readonly localPlayer: number;
  /** Every PLAYING seat (`controller` user or computer), in slot order — the original's
   *  `EnumeratePlayers(…, onlyPlayableSlots: 1)` for an omitted player parameter. */
  readonly playablePlayers: readonly number[];
  /** This match is a campaign MISSION (`m_isCampaignMission`). `motherland` is refused
   *  outside one, exactly as the original refuses it. */
  readonly campaign: boolean;
  readonly cheats: CheatState;

  /** Add resources without upkeep/divert tax (`CPlayerWar3::AddGold/AddLumber` with the two
   *  tax flags clear — the cheat's own call). */
  addGold(player: number, amount: number): void;
  addLumber(player: number, amount: number): void;
  /** UnitApplyCooldownCheat — kill every CAbilitySpell cooldown in the world. */
  clearCooldowns(): void;
  /** CPlayerUpgrade::IncrementUpgrades for player ids 0..11. */
  incrementUpgrades(): void;
  /** CGameState::TimeOfDaySet. */
  setTimeOfDay(hour: number): void;
  /** CGameState::TimeOfDayHaltTime / ResumeTime (the `haltTOD_Script` owner). */
  haltTimeOfDay(on: boolean): void;
  /** `iseedeadpeople`: the fog and its mask, for THIS machine only. */
  setRevealAll(on: boolean): void;
  /** Rebuild the command card and the resource bar after a state change. */
  refreshUi(): void;
  /** `CHEATENABLED` / `CHEATDISABLED` from GlobalStrings.fdf, over the local player. */
  showCheatMessage(enabled: boolean): void;
  /** `motherland <campaign> <level>` — mark the chapter open and ChangeLevel to it. */
  jumpCampaign(campaign: string, level: number): void;
  /** `allyourbasearebelongtous` / `somebodysetusupthebomb` — DispatchPlayerVictory/Defeat
   *  for the local player. */
  endGameForLocalPlayer(victory: boolean): void;
  /** `maxfps <n>` — CPreferencesWar3 preference 22 (`PREF_VIDEO_MAXFPS`), applied live. */
  setMaxFps(maxFps: number): void;
  /** `SetSong`'s body. Not reachable by a typed word (see the header); exposed to dev tools. */
  playSong(): void;
}

export interface CheatCommand {
  /** The literal, lower case. Matching is case-insensitive, as `SStrHash64` upper-cases. */
  word: string;
  /** Parameter spec in command order; the defaults are the original's. */
  params: readonly CheatParam[];
  /** The `CCheatData+4` bit this command owns, or null for a one-shot. */
  flag: CheatFlagValue | null;
  /** True for the `Recv*` handlers that toggle a bit; false for the one-shots, whose
   *  CheatMessage is always "enabled". */
  toggle: boolean;
  /** Does the original print CHEATENABLED/CHEATDISABLED at all? `MaxFPS` and `SetSong` do
   *  not (they never call CheatMessage). */
  says: boolean;
  /** One line of the original handler, for the dev tools and docs/cheats.md. */
  effect: string;
  /** Runs the handler. A returned boolean is the state the cheat message reports; `"skip"`
   *  means the handler refused or never reports (the original's early returns), and `void`
   *  means "the command's own default" — a toggle's resulting state, or `true` one-shot. */
  run(host: CheatHost, args: ReadonlyArray<number | string>): boolean | "skip" | void;
}

type CheatFlagValue = (typeof CheatFlag)[keyof typeof CheatFlag];

/** `greedisgood`'s second parameter: -1 means "every playable slot". */
function resources(
  host: CheatHost,
  args: ReadonlyArray<number | string>,
  kind: "gold" | "lumber" | "both",
): void {
  const amount = Number(args[0]);
  const player = Number(args[1]);
  const targets = player === -1 ? host.playablePlayers : [player];
  for (const p of targets) {
    if (kind !== "lumber") host.addGold(p, amount);
    if (kind !== "gold") host.addLumber(p, amount);
  }
}

/**
 * The game's cheat table. Order is `InstallCheats`'s own registration order, which is also the
 * `[Telemetry]` key order a..v — the mapping is pinned in docs/cheats.md.
 */
export const CHEAT_COMMANDS: readonly CheatCommand[] = [
  {
    word: "warpten",
    params: [],
    flag: CheatFlag.FastBuild,
    toggle: true,
    says: true,
    effect: "Build/train/research time ×16 (CUnit::BuildRate returns 16; UnitApplyBuildRateChange re-rates live jobs).",
    run: (h) => {
      h.cheats.toggle(CheatFlag.FastBuild);
    },
  },
  {
    word: "iocainepowder",
    params: [],
    flag: CheatFlag.FastDeath,
    toggle: true,
    says: true,
    effect: "Corpse and hero-body decay time ÷16 (CUnit::TaskDecay / TaskDecayBone).",
    run: (h) => {
      h.cheats.toggle(CheatFlag.FastDeath);
    },
  },
  {
    word: "pointbreak",
    params: [],
    flag: CheatFlag.Food,
    toggle: true,
    says: true,
    effect: "The supply cap stops refusing: CPlayerWar3::HasFoodCapRoom returns true; the readout still shows the real numbers.",
    run: (h) => {
      h.cheats.toggle(CheatFlag.Food);
      h.refreshUi();
    },
  },
  {
    word: "whosyourdaddy",
    params: [],
    flag: CheatFlag.God,
    toggle: true,
    says: true,
    effect:
      "God mode by CONTROLLER: a non-user source does 0 to a user's unit; a user's blow lands originalAmount ×100 on a non-user. Two computers, or two people, are unaffected.",
    run: (h) => {
      h.cheats.toggle(CheatFlag.God);
    },
  },
  {
    word: "keysersoze",
    params: [
      { kind: "int", default: 500 },
      { kind: "int", default: -1 },
    ],
    flag: null,
    toggle: false,
    says: true,
    effect: "Add gold (default 500) to one player, or to every playable slot.",
    run: (h, a) => resources(h, a, "gold"),
  },
  {
    word: "leafittome",
    params: [
      { kind: "int", default: 500 },
      { kind: "int", default: -1 },
    ],
    flag: null,
    toggle: false,
    says: true,
    effect: "Add lumber (default 500) to one player, or to every playable slot.",
    run: (h, a) => resources(h, a, "lumber"),
  },
  {
    word: "greedisgood",
    params: [
      { kind: "int", default: 500 },
      { kind: "int", default: -1 },
    ],
    flag: null,
    toggle: false,
    says: true,
    effect: "Add the same amount of gold AND lumber (default 500) to one player, or to every playable slot.",
    run: (h, a) => resources(h, a, "both"),
  },
  {
    word: "thereisnospoon",
    params: [],
    flag: CheatFlag.Mana,
    toggle: true,
    says: true,
    effect:
      "Mana is never short and never spent: CUnit::EnoughMana true, SpendMana a no-op, and the Mana Drain / Immolation drain modifiers are not installed.",
    run: (h) => {
      h.cheats.toggle(CheatFlag.Mana);
      h.refreshUi();
    },
  },
  {
    word: "thedudeabides",
    params: [],
    flag: CheatFlag.Cooldown,
    toggle: true,
    says: true,
    effect: "On ENABLE, kill every CAbilitySpell cooldown in the world (UnitApplyCooldownCheat). The bit itself has no ongoing effect.",
    run: (h) => {
      if (h.cheats.toggle(CheatFlag.Cooldown)) h.clearCooldowns();
    },
  },
  {
    word: "strengthandhonor",
    params: [],
    flag: CheatFlag.NoDefeat,
    toggle: true,
    says: true,
    effect: "No defeat: IsNoDefeatCheat answers true and the end-game path will not declare this player beaten.",
    run: (h) => {
      h.cheats.toggle(CheatFlag.NoDefeat);
    },
  },
  {
    word: "itvexesme",
    params: [],
    flag: CheatFlag.NoVictory,
    toggle: true,
    says: true,
    effect: "No victory: IsNoVictoryCheat answers true (the defeat/victory cheat buttons are the other half).",
    run: (h) => {
      h.cheats.toggle(CheatFlag.NoVictory);
    },
  },
  {
    word: "whoisjohngalt",
    params: [],
    flag: CheatFlag.Research,
    toggle: true,
    says: true,
    effect: "Abilities and hero skills ignore their research requirements (CAbility::HasDep / CAbilityHero::HasDep).",
    run: (h) => {
      h.cheats.toggle(CheatFlag.Research);
      h.refreshUi();
    },
  },
  {
    word: "sharpandshiny",
    params: [],
    flag: null,
    toggle: false,
    says: true,
    effect: "Every upgrade in the table gains a level for player ids 0..11 (CPlayerUpgrade::IncrementUpgrades). Effect ids starting `_`/`-` are skipped.",
    run: (h) => {
      h.incrementUpgrades();
      h.refreshUi();
    },
  },
  {
    word: "synergy",
    params: [],
    flag: CheatFlag.TechTree,
    toggle: true,
    says: true,
    effect: "Units, upgrades, morphs and shop units ignore their tech requirements (CAbilityBaseBuild/Queue/Research/SellUnit/Train/Morph::HasDep).",
    run: (h) => {
      h.cheats.toggle(CheatFlag.TechTree);
      h.refreshUi();
    },
  },
  {
    word: "iseedeadpeople",
    params: [],
    flag: CheatFlag.ShowMap,
    toggle: true,
    says: true,
    effect: "Fog and fog mask off for the local machine (CFogOfWarMap::EnableFog/EnableMask + WorldSetFogDisplay).",
    run: (h) => {
      const on = h.cheats.toggle(CheatFlag.ShowMap);
      h.setRevealAll(on);
    },
  },
  {
    word: "riseandshine",
    params: [],
    flag: null,
    toggle: false,
    says: true,
    effect: "Set the clock to `[Misc] Dawn` (6.00).",
    run: (h) => h.setTimeOfDay(dataNum("Dawn")),
  },
  {
    word: "lightsout",
    params: [],
    flag: null,
    toggle: false,
    says: true,
    effect: "Set the clock to `[Misc] Dusk` (18.00).",
    run: (h) => h.setTimeOfDay(dataNum("Dusk")),
  },
  {
    word: "daylightsavings",
    params: [{ kind: "float", default: -1 }],
    // The BIT only belongs to the -1 form; a positive value is a one-shot set.
    flag: CheatFlag.HaltTimeOfDay,
    toggle: true,
    says: true,
    effect: "`daylightsavings <hour>` sets the clock; `daylightsavings -1` toggles TimeOfDayHaltTime (the clock holds).",
    run: (h, a) => {
      const hour = Number(a[0]);
      if (hour === -1) {
        const on = h.cheats.toggle(CheatFlag.HaltTimeOfDay);
        h.haltTimeOfDay(on);
        return on;
      }
      h.setTimeOfDay(hour);
      return true;
    },
  },
  {
    word: "motherland",
    params: [
      { kind: "string", default: "human" },
      { kind: "int", default: 1 },
    ],
    flag: null,
    toggle: false,
    says: true,
    effect: "Campaign only: open every mission up to the chosen level and ChangeLevel to it (`<campaign> <level>`, level is 1-based).",
    run: (h, a) => {
      if (h.networked || !h.campaign) return "skip"; // the original's early return: no message
      h.jumpCampaign(String(a[0]), Number(a[1]));
      return true;
    },
  },
  {
    word: "somebodysetusupthebomb",
    params: [],
    flag: null,
    toggle: false,
    says: true,
    effect: "Declare the local player DEFEATED (CPlayerWar3::DispatchPlayerDefeat).",
    run: (h) => h.endGameForLocalPlayer(false),
  },
  {
    word: "allyourbasearebelongtous",
    params: [],
    flag: null,
    toggle: false,
    says: true,
    effect: "Declare the local player VICTORIOUS (CPlayerWar3::DispatchPlayerVictory).",
    run: (h) => h.endGameForLocalPlayer(true),
  },
  {
    word: "maxfps",
    params: [{ kind: "int", default: 200 }],
    flag: null,
    toggle: false,
    says: false,
    effect: "Console command registered outside Telemetry: CPreferencesWar3 preference 22, applied at once. No cheat message.",
    run: (h, a) => h.setMaxFps(Number(a[0])),
  },
];

/** Word → command. Two tables (§ the words are matched case-insensitively). */
const BY_WORD = new Map(CHEAT_COMMANDS.map((c) => [c.word, c]));

/** The original token separators: `ProcessCommand`'s `SStrTokenize(…, " ,;()\"\t")`. */
const SEPARATORS = /[ ,;()"\t]+/;

export interface ParsedCheat {
  command: CheatCommand;
  args: Array<number | string>;
}

/**
 * Parse a typed line the way `ProcessCommand` does: split on the console's own separators,
 * take the first token as the command (case-insensitively, as `SStrHash64` upper-cases), and
 * fill the rest into the command's parameter list. Missing parameters take their defaults;
 * an unparsable number refuses the whole line (the original's `ParamBuildFromString` returns
 * 0 and the handler never runs).
 */
export function parseCheat(text: string): ParsedCheat | null {
  const tokens = text.trim().split(SEPARATORS).filter(Boolean);
  if (!tokens.length) return null;
  // The FIRST token is hashed case-insensitively (`SStrHash64` upper-cases); the parameters
  // are taken as typed, which matters for a string parameter such as `motherland`'s campaign.
  const command = BY_WORD.get(tokens[0].toLowerCase());
  if (!command) return null;
  const args: Array<number | string> = [];
  for (let i = 0; i < command.params.length; i++) {
    const spec = command.params[i];
    const token = tokens[i + 1];
    if (token === undefined) {
      args.push(spec.kind === "string" ? spec.default : Number(spec.default));
      continue;
    }
    if (spec.kind === "string") {
      args.push(token);
      continue;
    }
    const n = Number(token);
    if (!Number.isFinite(n)) return null;
    args.push(spec.kind === "int" ? Math.trunc(n) : n);
  }
  return { command, args };
}

/**
 * Run one typed line. Returns the command that ran (or null), so the caller can decide what
 * to say: a toggle reports its resulting state, a one-shot always reports "enabled", and
 * `maxfps` says nothing at all.
 *
 * The `=` repeat is the caller's: `ProcessCommand` keeps `s_lastCommand`, which in our console
 * is the last line that PARSED (mapViewer's `lastCheatLine`).
 */
export function runCheat(host: CheatHost, text: string): CheatCommand | null {
  if (host.networked) return null;
  const parsed = parseCheat(text);
  if (!parsed) return null;
  const result = parsed.command.run(host, parsed.args);
  if (parsed.command.says && result !== "skip") {
    const enabled =
      typeof result === "boolean"
        ? result
        : parsed.command.toggle && parsed.command.flag !== null
          ? host.cheats.is(parsed.command.flag)
          : true;
    host.showCheatMessage(enabled);
  }
  return parsed.command;
}

/** The song command's effect, for the dev tools — see `CHEAT_SONG_FILE` and the header. */
export function playCheatSong(host: CheatHost): void {
  if (host.networked) return;
  host.playSong();
}
