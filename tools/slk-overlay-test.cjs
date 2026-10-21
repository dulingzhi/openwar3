// Map-internal SLK object data (data/mapOverlay.ts) against the real DSIII archive.
//
//   npx tsc -p tools/tsconfig.jass.json
//   node tools/slk-overlay-test.cjs [mapPath]
//
// DSIII is a protected map whose object system ships as TEXT TABLES inside the archive
// (Units\UnitData.slk and friends) instead of the binary war3map.w3u. Proves the overlay
// rebuild: the loaders accept the map archive as a second source, its rows merge over the
// install's, and the custom hero ids (H000/H001) come out as usable defs instead of the
// blank-body unknownUnitDef fallback.

const { readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO = resolve(__dirname, '..');
const BUILD = join(REPO, '.jass-build', 'src');
if (!existsSync(join(BUILD, 'data', 'units.js'))) {
  console.error('Build first:  npx tsc -p tools/tsconfig.jass.json');
  process.exit(2);
}

const MAP = process.argv[2] ?? process.env.DSIII_MAP ?? 'F:/Games/War3/Maps/Test/DSIII.w3x';
if (!existsSync(MAP)) {
  console.log(`skip: map not found at ${MAP}`);
  process.exit(0);
}

const { openInstall } = require(join(REPO, 'tools', 'install.cjs'));
const mpqMod = require('mdx-m3-viewer/dist/cjs/parsers/mpq');
const MpqArchive = (mpqMod.default ?? mpqMod).Archive;

const { loadUnitRegistry } = require(join(BUILD, 'data', 'units.js'));
const { loadAbilityRegistry } = require(join(BUILD, 'data', 'abilities.js'));
const { loadItemRegistry } = require(join(BUILD, 'data', 'items.js'));
const { loadUpgradeRegistry } = require(join(BUILD, 'data', 'upgrades.js'));
const { MAP_SLK_PATHS, mapHasSlkData, tolerantSource } = require(join(BUILD, 'data', 'mapOverlay.js'));

let failures = 0;
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${got}${ok ? '' : ` (want ${want})`}`);
};

(async () => {
  const { vfs } = await openInstall(process.env.OPENWAR3_INSTALL ?? 'F:/Games/War3');
  const archive = new MpqArchive();
  archive.load(new Uint8Array(readFileSync(MAP)), true);
  const map = {
    label: 'DSIII.w3x',
    exists: (p) => archive.get(p) != null,
    read: async (p) => { const e = archive.get(p); if (!e) throw new Error(`no ${p}`); return new Uint8Array(e.arrayBuffer()); },
    rawBytes: (p) => { const e = archive.get(p); return e ? new Uint8Array(e.arrayBuffer()) : null; },
    list: () => archive.getFileNames(),
  };

  check('map probe sees SLK tables', mapHasSlkData(map), true);
  const present = MAP_SLK_PATHS.filter((p) => map.exists(p));
  console.log(`      tables in map: ${present.length} — ${present.join(', ')}`);

  // The overlay rebuild must not throw where the old single-source load did not. The map
  // archive goes through tolerantSource exactly as loadMapObjectData hands it over — DSIII
  // keeps `Units\NeutralUnitStrings.txt` as a hash-table name whose data throws on decode.
  let reg, ab, it, up;
  try {
    const overlay = tolerantSource(map);
    reg = loadUnitRegistry(vfs, overlay);
    ab = loadAbilityRegistry(vfs, overlay);
    it = loadItemRegistry(vfs, overlay);
    up = loadUpgradeRegistry(vfs, overlay);
    check('registries rebuild with overlay', true, true);
  } catch (err) {
    check('registries rebuild with overlay', `threw: ${err.message}`, 'no throw');
    console.log(err.stack.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  }

  // The install's own rows survive the merge (a stock Footman is still a Footman — the
  // install here is localized, so assert the row exists and is named at all).
  const footman = reg.get('hfoo');
  check('stock row survives (hfoo named)', !!(footman?.name && footman.name.length > 0), true);

  // …and the map's custom hero ids resolve to REAL defs — a model file, real hit points,
  // not the unknownUnitDef blank body the DSIII hero used to spawn with.
  for (const id of ['H000', 'H001']) {
    const d = reg.get(id);
    check(`${id} resolves`, !!d, true);
    if (d) {
      console.log(`      ${id}: name="${d.name}" model="${d.model}" hp=${d.hitPoints}`);
      check(`${id} has a model`, !!(d.model && d.model.length > 3), true);
      check(`${id} has hit points`, (d.hitPoints ?? 0) > 0, true);
    }
  }
  const counts = `units ${reg.all().length}, abilities ${ab.all().length}, items ${it.all().length}, upgrades ${up.all().length}`;
  console.log(`      counts — ${counts}`);

  console.log(failures === 0 ? '\nSLK overlay holds against DSIII' : `\n${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error('FATAL:', err); process.exit(1); });
