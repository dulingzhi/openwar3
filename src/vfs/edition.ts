import type { DataSource } from "./types";
import { dataSetFolder } from "../data/edition";

// The DATA SET, laid over the live paths (docs/editions.md).
//
// A 1.30.4 store keeps ONE set of object tables at their ordinary paths (`Units\UnitData.slk`)
// and THREE more complete copies one folder down, at the SAME path under `Melee_V0\`,
// `Custom_V1\` and `Custom_V0\` — every `Units\*` table, the melee `Scripts\*.ai` with their
// `.pld`s, and `UI\FrameDef\InfoPanelStrings.fdf` (whose armour tips describe the set's own
// damage table). That is the whole of the rule, so it is written as one: a path that has a twin
// under the folder `dataSetFolder()` names reads the twin.
//
// The four corners are (edition × map kind), and the LIVE paths are the fourth — The Frozen
// Throne's MELEE tables — which is why the store ships no `Melee_V1\`. Both axes matter and
// each was learned the hard way:
//   • the EDITION, because 232 of the 468 units the two games share change armour class
//     (docs/editions.md);
//   • the MAP KIND, because melee carries the balance patches 1.29+ made and custom is frozen
//     where the game shipped. A campaign chapter is a custom map, so on Reign of Chaos its
//     Grunt has `Custom_V0`'s **680** hit points and not the 700 every other set gives it.
//
// Both are read at EVERY lookup rather than baked in, because the menu flips the edition on a
// mounted install and every match may bring the other kind of map. Anything that parsed a table
// before the flip still holds the old set's copy; the things that cache across matches are told
// through `onEditionChange`, which both switches fire (src/data/edition.ts).
// **How much of this an MPQ-era install actually has depends on WHICH one.** A 1.27 folder was
// measured rather than assumed: it carries `Melee_V0` (68 files), `Custom_V0` (64) and `Custom_V1`
// (64) — balance tables, unit funcs, the four race AI scripts and the localized strings — and no
// `Melee_V1`, which is right, because a Frozen Throne melee game reads the LIVE paths. So the
// overlay is live on 1.27 too, and a Reign of Chaos melee game there reads `Melee_V0`'s
// `UnitBalance.slk` exactly as it does on 1.30.4. What a set does not have, `resolve` falls back
// from on its own: `UnitData.slk` is absent from all three, so the unit table is the live one and
// only the balance over it is the edition's. An install with none of the folders at all reads the
// live tables throughout, which is what this used to say of every MPQ folder.

export class EditionDataSource implements DataSource {
  constructor(private base: DataSource) {}

  get label(): string {
    return this.base.label;
  }

  /** The path the current edition + map kind reads `path` from. */
  private resolve(path: string): string {
    const set = dataSetFolder();
    if (set === null) return path;
    const twin = `${set}\\${path.replace(/\//g, "\\").replace(/^\\+/, "")}`;
    return this.base.exists(twin) ? twin : path;
  }

  exists(path: string): boolean {
    return this.base.exists(path);
  }

  read(path: string): Promise<Uint8Array> {
    return this.base.read(this.resolve(path));
  }

  rawBytes(path: string): Uint8Array | null {
    return this.base.rawBytes(this.resolve(path));
  }

  list(): string[] {
    return this.base.list();
  }

  openArchive(path: string): DataSource | null {
    return this.base.openArchive?.(path) ?? null;
  }
}
