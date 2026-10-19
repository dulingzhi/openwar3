// The cheat register — the STATE half.
//
// Warcraft III's cheat switchboard is `InstallCheats` in Game.dll (1.30.4, image base
// 0x6F000000, `?InstallCheats@@YIXXZ` at 0x6F379E10). It allocates one `CCheatData`, hangs it
// on the application object, and registers twenty handlers — twenty console commands plus the
// net-command callbacks they send. Every toggle it owns is one BIT of a single dword at
// `CCheatData+4`, and the whole game asks that dword:
//
//   0x001  thedudeabides        cooldown timers wiped
//   0x002  whosyourdaddy        user units take nothing; their blows land ×100
//   0x004  warpten              build/train rate ×16
//   0x008  iocainepowder        corpse decay ÷16
//   0x010  pointbreak           the supply cap stops refusing
//   0x020  thereisnospoon       mana is never short and never spent
//   0x040  strengthandhonor     no defeat
//   0x080  itvexesme            no victory
//   0x100  whoisjohngalt        abilities ignore their research requirements
//   0x200  iseedeadpeople       the fog is off
//   0x400  synergy              units/upgrades ignore their tech requirements
//   0x800  daylightsavings -1   the clock is held
//
// The bit VALUES are the game's (see each `Recv*` handler in Game.dll: `RecvGod` tests
// `(*(_BYTE *)(cheat + 4) & 2)`, `RecvShowMap` tests `& 0x200`, and so on). The state lives on
// the SIM because that is where every consumer already is — WC3 reads the same dword from
// inside `CUnit::TakeDamage`, `CUnit::BuildRate`, `CPlayerWar3::HasFoodCapRoom`, `CUnit::
// EnoughMana` and `CUnit::SpendMana`, exactly the places we ask it.
//
// SINGLE PLAYER ONLY. In 1.30.4 the chat box is fed to the console only when
// `!NetIsMultiPlayer()` (`CGameUI::OnChatSend`), and a cheat is a NET COMMAND
// (`NetSendCheat`) that every peer would apply — which is why the original never lets one be
// typed online. Our controller refuses every cheat in a networked match for the same reason;
// see RtsController.cheat and render/mapViewer.ts `cheatsAllowed`.

/** The cheat bits, in the original's own order and positions (`CCheatData+4`). */
export const CheatFlag = {
  Cooldown: 0x001,
  God: 0x002,
  FastBuild: 0x004,
  FastDeath: 0x008,
  Food: 0x010,
  Mana: 0x020,
  NoDefeat: 0x040,
  NoVictory: 0x080,
  Research: 0x100,
  ShowMap: 0x200,
  TechTree: 0x400,
  HaltTimeOfDay: 0x800,
} as const;

export type CheatFlagValue = (typeof CheatFlag)[keyof typeof CheatFlag];

/**
 * The cheat dword. A bitmask rather than twelve booleans because that is literally what the
 * original is, and because `CheatEnabled(flag)` is asked from hot paths (`CUnit::TakeDamage`,
 * `CUnit::SpendMana` — hundreds of times a frame in a big fight).
 */
export class CheatState {
  private bits = 0;

  /** The raw dword. Kept public for a test that wants to pin a value against the original. */
  get mask(): number {
    return this.bits;
  }

  is(flag: number): boolean {
    return (this.bits & flag) !== 0;
  }

  set(flag: number, on: boolean): void {
    if (on) this.bits |= flag;
    else this.bits &= ~flag;
  }

  /** Flip a flag and answer the resulting state — `Recv*`'s `enabled` return. */
  toggle(flag: number): boolean {
    this.bits ^= flag;
    return (this.bits & flag) !== 0;
  }

  /** A new match starts with every cheat off (the CCheatData is allocated per game). */
  reset(): void {
    this.bits = 0;
  }
}
