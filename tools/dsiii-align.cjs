// DSIII.w3x — the real JASS/DzAPI alignment map.
//
//   npx tsc -p tools/tsconfig.jass.json
//   node tools/dsiii-align.cjs [--install F:/Games/War3] [--map <DSIII.w3x>] [--strict]
//
// Mounts the developer's own 1.27 MPQ install, reads its common.j/Blizzard.j, loads the map's
// 1.7 MB war3map.j and runs config()/main(). It reports every native the map calls that this
// engine has not implemented yet — the list the DzAPI packs are meant to empty.
//
// This is a JASS/native alignment, not a Lua test and not a visual one: DSIII has no Lua. It
// is the best functional target we have for the DzFrame* surface (366 SetPoint, 231
// CreateFrameByTagName, …), and it is why the frame pack comes before the rest.

const { writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO = resolve(__dirname, '..');
const BUILD = join(REPO, '.jass-build', 'src');
if (!existsSync(join(BUILD, 'compat', 'lua', 'host.js'))) {
  console.error('Build first:  npx tsc -p tools/tsconfig.jass.json');
  process.exit(2);
}
writeFileSync(join(REPO, '.jass-build', 'package.json'), '{"type":"commonjs"}');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const INSTALL = resolve(arg('--install', 'F:/Games/War3'));
const MAP = resolve(arg('--map', 'F:/Games/War3/Maps/Test/DSIII.w3x'));
const STRICT = args.includes('--strict');
const BS = String.fromCharCode(92);

const { openInstall } = require(join(REPO, 'tools', 'install.cjs'));
const mpqMod = require('mdx-m3-viewer/dist/cjs/parsers/mpq');
const MpqArchive = (mpqMod.default ?? mpqMod).Archive;
const { buildInterpreter } = require(join(BUILD, 'jass', 'headless.js'));
const { COMPAT_PRELUDE } = require(join(BUILD, 'compat', 'prelude.js'));
const { installDzapi } = require(join(BUILD, 'compat', 'lua', 'japi', 'dzapi', 'index.js'));

(async () => {
  if (!existsSync(MAP)) { console.error(`map not found: ${MAP}`); process.exit(2); }
  if (!existsSync(INSTALL)) { console.error(`install not found: ${INSTALL}`); process.exit(2); }

  const { kind, vfs } = await openInstall(INSTALL);
  const decode = (b) => new TextDecoder('windows-1252').decode(b);
  const common = vfs.rawBytes(`Scripts${BS}common.j`);
  const blizzard = vfs.rawBytes(`Scripts${BS}Blizzard.j`);
  if (!common || !blizzard) {
    console.error(`no Scripts${BS}common.j / Blizzard.j in ${INSTALL}`);
    process.exit(2);
  }
  const mapArchive = new MpqArchive();
  mapArchive.load(new Uint8Array(readFileSync(MAP)), true);
  const mapJ = mapArchive.get('war3map.j');
  if (!mapJ) { console.error('the map has no war3map.j'); process.exit(2); }
  const wtsEntry = mapArchive.get('war3map.wts');
  const wts = wtsEntry ? new TextDecoder('utf-8').decode(new Uint8Array(wtsEntry.arrayBuffer())) : undefined;

  console.log(`install: ${kind} ${vfs.label}`);
  console.log(`map:     ${MAP} (${readFileSync(MAP).byteLength} bytes)`);

  const notes = [];
  const info = console.info, warn = console.warn;
  console.info = (...a) => notes.push(a.join(' '));
  console.warn = console.info;

  let interp = null;
  const t0 = Date.now();
  try {
    interp = buildInterpreter([decode(common), COMPAT_PRELUDE, decode(blizzard), decode(mapJ.arrayBuffer())], { wts });
  } catch (err) {
    console.info = info; console.warn = warn;
    console.log(`\nPARSE/LOAD ERROR after ${Date.now() - t0} ms: ${err.message}`);
    process.exit(1);
  }
  installDzapi(interp.rt);
  const loadMs = Date.now() - t0;
  let hardError = null;
  for (const fn of ['config', 'main']) {
    try { interp.callFunction(fn, []); }
    catch (err) { hardError = `${fn}: ${err.message}`; break; }
  }
  console.info = info;
  console.warn = warn;

  console.log(`loaded in ${loadMs} ms — natives ${interp.rt.natives.size}, functions ${interp.rt.functions.size}, globals ${interp.rt.globals.size}`);
  if (hardError) {
    console.log(`\n${hardError}`);
    process.exit(1);
  }
  console.log('config() / main() OK');

  const missing = new Map();
  const other = [];
  for (const line of notes) {
    const m = /native '([^']+)' not implemented/.exec(line);
    if (m) { missing.set(m[1], (missing.get(m[1]) ?? 0) + 1); continue; }
    if (/unknown function|undefined variable|safe default|threw/.test(line)) other.push(line);
  }

  const sorted = [...missing.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  console.log(`\nmissing natives: ${sorted.length} distinct (${sorted.reduce((n, [, c]) => n + c, 0)} call sites)`);
  for (const [name, count] of sorted) console.log(`  ${String(count).padStart(4)}  ${name}`);

  if (other.length) {
    console.log(`\nother notes: ${other.length}`);
    for (const line of other.slice(0, 20)) console.log(`  ${line.slice(0, 170)}`);
  }

  if (STRICT && sorted.length) process.exit(1);
  process.exit(0);
})();
