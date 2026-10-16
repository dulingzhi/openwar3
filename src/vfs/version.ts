import { buildInfoVersion, isCascInstall } from "./casc";
import type { PickedInstall } from "../assets/opfs";
import { t } from "../i18n";

// Which Warcraft III an install has to be, and why the answer is not "any of them".
//
// **Every player must be running the same game DATA.** A match's units, abilities, costs and
// timings are read out of each machine's own install (that is the whole asset-compatible
// design), so two players on different patches are two players playing different games: the
// authority resolves an order against ITS Footman and the client draws the one in its own SLKs.
// Nothing in the wire protocol can catch that on its own — `PROTOCOL_VERSION` says the two
// CLIENTS agree, which is a different question and answered in a different place
// (src/net/protocol.ts). A LAN room therefore also carries *which data* each machine holds, and
// refuses a mismatch at join (see `gameData` below); the gate here is what keeps that label
// honest, and it is why a folder that does not match is refused rather than warned about.
//
// So the version is a gate rather than a note, and it is checked on EVERY launch and not only
// when the folder is first picked: the desktop app remembers a folder and reads it again next
// time (src/assets/nativeInstall.ts), and a player can patch Warcraft III between one launch and
// the next without touching OpenWar3 at all.
//
// **Two builds are played, and they are two STORAGES.** 1.30.4 is the last build of the
// pre-Reforged client and the one this engine is written against (docs/casc.md); it is a CASC
// content store and says which build it is in `.build.info`. 1.27 is the MPQ era's last widely
// used release — the one a competitive scene and a decade of Chinese platform clients still run
// — and an MPQ folder has no `.build.info` at all, so its version comes out of the game
// executable's own resource table instead (src/vfs/peVersion.ts).
//
// The two were checked against each other rather than assumed compatible: every one of the 92
// `MiscGame.txt` and 44 `MiscData.txt` rows this engine transcribes (src/data/gameplayConstants.ts)
// is byte-identical between them, and 21 of the 22 melee constants in `Blizzard.j` are. What does
// differ is the unit and ability tables, which are read from the install at runtime — so a 1.27
// match is a 1.27 match throughout, and a mixed one would be a match where the two sides disagree
// about what a Footman is.

/** The CASC build OpenWar3 plays. Matched on the first three components — `.build.info` carries a
 *  fourth (the build number, 11274 here) that varies with the download and says nothing about
 *  the data. MUST equal `REQUIRED_VERSION` in electron/install.mjs, which asks the same question
 *  of the folder dialog before the answer can be remembered; `pnpm app:test` compares them. */
export const REQUIRED_VERSION = "1.30.4";

/** The MPQ-era build OpenWar3 plays, matched on the first TWO components.
 *
 *  Two rather than three because 1.27 shipped as 1.27a (`1.27.0.52240` — the build read off the
 *  retail install, verified) and then 1.27b, and the letters of one release are the same game
 *  data: a bug-fix build that moved a balance number would not have been a letter. Three
 *  components would refuse 1.27b for saying `1.27.1` and accept only the one build we happened
 *  to have a copy of, which is the opposite of what the rule is for. MUST equal
 *  `REQUIRED_MPQ_VERSION` in electron/install.mjs; `pnpm app:test` compares them. */
export const REQUIRED_MPQ_VERSION = "1.27";

/** How the two builds are named to the player, in the reader's own language. The numbers are the
 *  same either way; the word between them is not, which is why this is a translation key rather
 *  than a template built here (src/i18n.ts). */
export const plays = (): string => t("version.plays");

/** What to say about a folder that is the wrong build. One sentence, naming BOTH versions, so
 *  the player can see what they have as well as what is wanted. Shared by the load gate and by
 *  the desktop app's remembered-folder check, which reach the same conclusion by different
 *  routes and must not word it differently. */
export const wrongVersionMessage = (version: string | null): string =>
  version
    ? t("version.wrong", { version, plays: plays() })
    : t("version.unknown", { plays: plays() });

export interface VersionVerdict {
  ok: boolean;
  /** What the install says it is, when it says anything at all. */
  version: string | null;
  /** Empty when `ok`. Shown to the player verbatim, so it names both versions. */
  message: string;
  /** Which game data this is, as a LAN room records it — `"1.30.4"` or `"1.27"` — or null when
   *  the folder was refused. The label the wire carries, and the reason it is derived HERE rather
   *  than by the lobby: it can only ever be a build the gate accepted. */
  data: string | null;
}

/** Does this version string name the CASC build we play? */
export const isRequiredVersion = (version: string | null): boolean =>
  !!version && version.split(".").slice(0, 3).join(".") === REQUIRED_VERSION;

/** Does this version string name the MPQ-era build we play? */
export const isRequiredMpqVersion = (version: string | null): boolean =>
  !!version && version.split(".").slice(0, 2).join(".") === REQUIRED_MPQ_VERSION;

/**
 * Which game data a mounted install holds, as a LAN room records it — `"1.30.4"` or `"1.27"`.
 *
 * Set at the one door every install comes through (`loadProfile`, src/vfs/loader.ts) and read by
 * the lobby when it creates or joins a room, so two machines on different Warcraft III builds
 * cannot silently play the same match. Null before an install is mounted, and a room created
 * before it is mounted carries nothing — which the relay treats as "unknown" rather than as a
 * match, refusing only two labels that are both present and differ.
 */
let instanceData: string | null = null;

export const gameData = (): string | null => instanceData;

/** Called by `loadProfile` only. The gate has already refused anything else by then. */
export function setGameData(data: string | null): void {
  instanceData = data;
}

/** Check a picked folder before it is mounted. */
export function checkVersion(install: PickedInstall): VersionVerdict {
  const casc = isCascInstall(install.casc);
  const refuse = (version: string | null, message: string): VersionVerdict => ({ ok: false, version, message, data: null });

  if (!casc && ![...install.files.keys()].some((k) => k.toLowerCase().endsWith(".mpq"))) {
    // Neither a content store nor an archive: not an old Warcraft III, not a Warcraft III at all
    // (or one whose data has gone). "Older than 1.30.4" would send the player to patch a folder
    // that has nothing in it to patch.
    return refuse(null, t("version.noData", { plays: plays() }));
  }

  if (casc) {
    const version = buildInfoVersion(install.casc!.buildInfo);
    return isRequiredVersion(version)
      ? { ok: true, version, message: "", data: REQUIRED_VERSION }
      : refuse(version, wrongVersionMessage(version));
  }

  // An MPQ-era folder. Its archives alone never say which build they are, so the answer comes
  // from the game executable — and a folder without a readable one is refused rather than
  // assumed to be the build we play, because "probably 1.27" is exactly the guess that makes
  // two players disagree about what a Footman is.
  const version = install.version;
  if (isRequiredMpqVersion(version)) return { ok: true, version, message: "", data: REQUIRED_MPQ_VERSION };
  if (!version) {
    return refuse(null, t("version.noExe", { plays: plays() }));
  }
  return refuse(version, wrongVersionMessage(version));
}
