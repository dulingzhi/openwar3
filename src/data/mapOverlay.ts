import { MappedData } from "mdx-m3-viewer/dist/cjs/utils/mappeddata";
import { wc3TextDecoder } from "../vfs/text";
import type { DataSource } from "../vfs/types";

// A map's object data can arrive as TEXT TABLES (Units\UnitData.slk and friends) instead of
// the binary war3map.w3u — a protected map has no w3u to find (DSIII ships its whole object
// system as SLKs inside the archive; docs/dzapi-port.md §3). Those tables merge OVER the
// install's, cell by cell: a row the map carries wins for the cells it names, a row only the
// install has stays. That is the engine's own layering, not a replacement — a map's
// UnitData.slk names the five rows it touches, not the whole game.

/** Read `path` from `install`, then merge `overlay`'s copy on top (both may be absent).
 *  `MappedData.load` merges rows per cell, so the overlay wins a shared cell and a new row
 *  joins. Returns null when neither source has the file. */
export function mergedTable(install: DataSource, overlay: DataSource | null | undefined, path: string): MappedData | null {
  const base = install.rawBytes(path);
  const over = overlay?.rawBytes(path) ?? null;
  if (!base && !over) return null;
  const data = new MappedData();
  if (base) data.load(wc3TextDecoder().decode(base));
  if (over) data.load(wc3TextDecoder().decode(over));
  return data;
}

/** The `Units\` paths a map's SLK overlay may carry — the probe loadMapObjectData uses to
 *  decide whether a rebuild is worth it. */
export const MAP_SLK_PATHS = [
  "Units\\UnitData.slk",
  "Units\\UnitBalance.slk",
  "Units\\UnitUI.slk",
  "Units\\UnitWeapons.slk",
  "Units\\UnitAbilities.slk",
  "Units\\AbilityData.slk",
  "Units\\AbilityBuffData.slk",
  "Units\\ItemData.slk",
  "Units\\DestructableData.slk",
  "Units\\UpgradeData.slk",
];

/** Does the map carry any data SLK at all? */
export function mapHasSlkData(map: DataSource | null | undefined): boolean {
  return !!map && MAP_SLK_PATHS.some((p) => map.exists(p));
}

/** Wrap the MAP source so a read that fails to decode counts as absent. A protected map's
 *  MPQ can carry a hash-table NAME whose data is gone or unreadable — DSIII keeps
 *  `Units\NeutralUnitStrings.txt` as such a leftover, and `MpqFile.decode` throws
 *  `RangeError: Invalid typed array length: 1` on it (tools/slk-overlay-test.cjs). The
 *  install side never sees these; only the overlay needs the guard. */
export function tolerantSource(map: DataSource): DataSource {
  return {
    label: map.label,
    exists: (p) => map.exists(p),
    read: async (p) => map.read(p),
    rawBytes: (p) => {
      try {
        return map.rawBytes(p);
      } catch {
        return null; // a name without readable data is a missing file
      }
    },
    list: () => map.list(),
    openArchive: (p) => map.openArchive?.(p) ?? null,
  };
}
