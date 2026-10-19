// Headless checks for the cheat register (Game.dll `InstallCheats`, docs/cheats.md).
//
// The bits, the words and the handlers are all the original's: the values were read out of
// `?InstallCheats@@YIXXZ` (0x6F379E10), the `Register*`/`Recv*` pairs beside it, and the
// hash-keyed names in `Units\Telemetry.txt`. This test pins the parts that are easy to get
// subtly wrong and invisible in a screenshot:
//
//   • the twelve bits of CCheatData+4, at their original positions;
//   • the word table and its parameters/defaults (including the hashed-key mapping a..u);
//   • god mode's CONTROLLER rule (computer→user = 0, user→computer = original ×100);
//   • the mana, supply and tech switches, and the one-shot doors (cooldown clear, upgrades);
//   • the parser's token separators and `=` repeat at the caller;
//   • the clock halt and fast build/decay.
//
// Run: pnpm sim:test
const { join } = require("node:path");
const REPO = join(__dirname, "..");
require("node:fs").writeFileSync(join(REPO, ".sim-build", "package.json"), '{"type":"commonjs"}');
const { SimWorld } = require(join(REPO, ".sim-build", "src", "sim", "world.js"));
const { CheatState, CheatFlag } = require(join(REPO, ".sim-build", "src", "sim", "cheats.js"));
const { parseCheat, runCheat, CHEAT_COMMANDS } = require(join(REPO, ".sim-build", "src", "game", "cheats.js"));

let failed = 0;
function check(what, got, want) {
  const ok = typeof want === "number" ? Math.abs(got - want) <= 1e-9 : got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}\n        want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

// --- the dword -------------------------------------------------------------------------
const EXPECTED_BITS = [
  ["Cooldown", 0x001],
  ["God", 0x002],
  ["FastBuild", 0x004],
  ["FastDeath", 0x008],
  ["Food", 0x010],
  ["Mana", 0x020],
  ["NoDefeat", 0x040],
  ["NoVictory", 0x080],
  ["Research", 0x100],
  ["ShowMap", 0x200],
  ["TechTree", 0x400],
  ["HaltTimeOfDay", 0x800],
];
for (const [name, bit] of EXPECTED_BITS) check(`CCheatData bit ${name}`, CheatFlag[name], bit);

const state = new CheatState();
check("a fresh register has no bits", state.mask, 0);
check("toggle reports the new state", state.toggle(CheatFlag.God), true);
check("…and the old one on the second press", state.toggle(CheatFlag.God), false);
state.set(CheatFlag.Mana, true);
state.set(CheatFlag.FastBuild, true);
check("bitmask is the union", state.mask, 0x024);
state.reset();
check("reset clears the dword", state.mask, 0);

// --- the word table --------------------------------------------------------------------
const WORDS = [
  "warpten", "iocainepowder", "pointbreak", "whosyourdaddy", "keysersoze", "leafittome",
  "greedisgood", "thereisnospoon", "thedudeabides", "strengthandhonor", "itvexesme",
  "whoisjohngalt", "sharpandshiny", "synergy", "iseedeadpeople", "riseandshine", "lightsout",
  "daylightsavings", "motherland", "somebodysetusupthebomb", "allyourbasearebelongtous",
  "maxfps",
];
for (const w of WORDS) check(`registered: ${w}`, !!CHEAT_COMMANDS.find((c) => c.word === w), true);
// Telemetry key order a..v, minus v (the song word the shipped hashes cannot name).
check("Telemetry a=warpten", CHEAT_COMMANDS[0].word, "warpten");
check("Telemetry u=allyourbasearebelongtous", CHEAT_COMMANDS[20].word, "allyourbasearebelongtous");
check("the unknown song key v is not exposed", CHEAT_COMMANDS.some((c) => c.word === "playsong"), false);

// --- the parser ------------------------------------------------------------------------
check("case-insensitive first token", parseCheat("GREEDISGOOD 500")?.command.word, "greedisgood");
check("the console's separators split parameters", parseCheat('keysersoze,300;0')?.args.join(","), "300,0");
check("defaults fill in", parseCheat("greedisgood")?.args.join(","), "500,-1");
check("an unparsable number refuses the line", parseCheat("keysersoze abc"), null);
check("an unknown word refuses the line", parseCheat("showmethemoney"), null);

// --- the command host ------------------------------------------------------------------
const applied = { gold: {}, lumber: {}, messages: [] };
const host = {
  networked: false,
  localPlayer: 0,
  playablePlayers: [0, 1],
  campaign: true,
  cheats: state,
  addGold: (p, n) => (applied.gold[p] = (applied.gold[p] ?? 0) + n),
  addLumber: (p, n) => (applied.lumber[p] = (applied.lumber[p] ?? 0) + n),
  clearCooldowns: () => (applied.cleared = (applied.cleared ?? 0) + 1),
  incrementUpgrades: () => (applied.upgrades = (applied.upgrades ?? 0) + 1),
  setTimeOfDay: (h) => (applied.tod = h),
  haltTimeOfDay: (on) => (applied.halt = on),
  setRevealAll: (on) => (applied.reveal = on),
  refreshUi: () => {},
  showCheatMessage: (on) => applied.messages.push(on),
  jumpCampaign: (c, n) => (applied.jump = `${c}:${n}`),
  endGameForLocalPlayer: (v) => (applied.end = v),
  setMaxFps: (n) => (applied.fps = n),
  playSong: () => (applied.song = (applied.song ?? 0) + 1),
};

state.reset();
runCheat(host, "greedisgood 250 0");
check("greedisgood's second parameter names one player", `${applied.gold[0]},${applied.lumber[0]}`, "250,250");
check("…and nobody else", applied.gold[1], undefined);
check("a one-shot always says enabled", applied.messages.at(-1), true);
runCheat(host, "greedisgood");
check("omitting the player hits every playable slot", `${applied.gold[0]}/${applied.gold[1]}`, "750/500");

applied.messages = [];
check("warpten toggles on", !!runCheat(host, "warpten"), true);
check("…reporting enabled", applied.messages.at(-1), true);
runCheat(host, "warpten");
check("…and disabled", applied.messages.at(-1), false);

applied.cleared = 0;
runCheat(host, "thedudeabides");
check("the cooldown cheat clears on enable", applied.cleared, 1);
runCheat(host, "thedudeabides");
check("…and does not clear again on disable", applied.cleared, 1);

runCheat(host, "sharpandshiny");
check("sharpandshiny increments the upgrade table", applied.upgrades, 1);

runCheat(host, "daylightsavings 12.5");
check("daylightsavings <hour> sets the clock", applied.tod, 12.5);
applied.messages = [];
runCheat(host, "daylightsavings -1");
check("daylightsavings -1 halts the clock", applied.halt, true);
check("…and says enabled", applied.messages.at(-1), true);
runCheat(host, "daylightsavings -1");
check("…then resumes it", applied.halt, false);

check("an unknown line is not a cheat", runCheat(host, "istealdd"), null);
runCheat(host, "synergy");
check("synergy sets its bit", state.is(CheatFlag.TechTree), true);
runCheat(host, "iseedeadpeople");
check("iseedeadpeople drives the reveal door", applied.reveal, true);
runCheat(host, "allyourbasearebelongtous");
check("victory dispatch", applied.end, true);
runCheat(host, "somebodysetusupthebomb");
check("defeat dispatch", applied.end, false);
runCheat(host, "maxfps 144");
check("maxfps reaches the frame cap", applied.fps, 144);
check("…and says nothing (the original never calls CheatMessage)", applied.messages.includes(true) && applied.fps === 144, true);
runCheat(host, "motherland human 3");
check("motherland passes the campaign and level through", applied.jump, "human:3");

// Networked: every door refuses, even the JASS one.
const netHost = { ...host, networked: true };
const before = state.mask;
check("a networked match refuses a cheat", runCheat(netHost, "whosyourdaddy"), null);
check("…leaving the dword untouched", state.mask, before);

// --- the sim's switches ----------------------------------------------------------------
const world = new SimWorld(
  { width: 64, height: 64, cell: 128, blocked: new Uint8Array(16), origin: [-4096, -4096] },
  1,
  { get: () => undefined },
  undefined,
  { get: () => undefined },
);
world.computerPlayers = new Set([1]);
let nextId = 1;
function unit(over = {}) {
  const u = {
    id: nextId++, owner: 0, team: 0, typeId: "hfoo", x: 0, y: 0, hp: 1000, maxHp: 1000,
    mana: 0, maxMana: 0, manaRegen: 0, hpRegen: 0, buffs: [], inventory: [], weapons: [], abilities: [],
    level: 1, isHero: false, building: null, mechanical: false, flying: false, invulnerable: false,
    neutralPassive: false, isIllusion: false, race: "human", str: 0, agi: 0, int: 0,
    garrison: [], garrisonCap: 0, cargoSize: 0, portalLeft: 0, devouring: 0,
    baseStr: 0, baseAgi: 0, baseInt: 0, startStr: 0, startAgi: 0, startInt: 0, strPerLevel: 0,
    agiPerLevel: 0, intPerLevel: 0, bonusStr: 0, bonusAgi: 0, bonusInt: 0, baseDamage: 0,
    baseMaxHp: 1000, baseMaxMana: 0, baseArmor: 0, armor: 0, baseSpeed: 270, speed: 270,
    baseSightDay: 1400, baseSightNight: 800, ...over,
  };
  world.units.set(u.id, u);
  return u;
}

// God: a computer's blow does nothing to a user; a user's blow lands ×100 of the ORIGINAL.
const user = unit({ owner: 0 });
const cpu = unit({ owner: 1 });
world.landDamage(user, 25, cpu.id, false, "", null, 25);
check("god off: the computer's 25 lands", user.hp, 975);
world.cheats.set(CheatFlag.God, true);
user.hp = 1000;
world.landDamage(user, 25, cpu.id, false, "", null, 25);
check("god on: a computer does 0 to a user", user.hp, 1000);
// A 5000-hp target so the ×100 blow is measured rather than truncated by a kill.
const big = unit({ owner: 1, hp: 5000, maxHp: 5000 });
world.landDamage(big, 10, user.id, false, "", null, 10);
check("god on: a user's blow is original ×100", big.hp, 5000 - 1000);
check("god on: computer vs computer is unchanged", (() => {
  const a = unit({ owner: 1 });
  const b = unit({ owner: 1 });
  world.landDamage(b, 10, a.id, false, "", null, 10);
  return b.hp;
})(), 990);

// Mana: EnoughMana/SpendMana.
const caster = unit({ mana: 5, maxMana: 100, abilities: [] });
check("enoughMana sees a short bar with the cheat off", world.enoughMana(caster, 25), false);
world.cheats.set(CheatFlag.Mana, true);
check("…and yes with it on", world.enoughMana(caster, 25), true);
world.spendMana(caster, 25);
check("spendMana takes nothing", caster.mana, 5);

// Cooldowns — every unit's card and belt.
const cooldownUnit = unit({ abilities: [{ cooldownLeft: 7 }], inventory: [{ cooldownLeft: 3 }] });
world.clearAllCooldowns();
check("clearAllCooldowns zeroes abilities", cooldownUnit.abilities[0].cooldownLeft, 0);
check("…and the item belt", cooldownUnit.inventory[0].cooldownLeft, 0);

// Fast build is a view of the bit.
world.cheats.set(CheatFlag.FastBuild, true);
check("fastBuild reflects warpten", world.fastBuild, true);

// Fast death: the decay ÷16, exactly as TaskDecay does.
world.cheats.set(CheatFlag.FastDeath, true);
check("iocainepowder divides decay by 16", world.decayTime(88), 5.5);

// Time-of-day halt. The tick is driven with an empty world — the clock is its own phase and
// needs no units, and a headless stub unit is not a whole SimUnit.
world.units.clear();
world.cheats.set(CheatFlag.HaltTimeOfDay, true);
world.timeOfDay = 8;
world.tick(1);
check("daylightsavings -1 holds the clock", world.timeOfDay, 8);
world.cheats.set(CheatFlag.HaltTimeOfDay, false);
world.tick(1);
check("…and lets it run again", world.timeOfDay != 8, true);

console.log(`\n${failed ? `${failed} FAILED` : "all cheat checks passed"}`);
process.exit(failed ? 1 : 0);
