// YD Lua / JAPI usage scanner (docs/lua-engine-implementation.md S0).
//
//   node tools/lua-usage-scan.cjs <folder-or-map …> [--out report.json] [--top 30]
//
// Reads maps the way the engine does (MPQ first; a CASC-era map is not the target here),
// extracts their scripts and every *.lua entry, and ranks:
//
//   * `require "…"` modules;
//   * `jass.<module>` names;
//   * EX*/Dz*/KK* JAPI call sites;
//   * EXSetUnit* slot indices;
//   * `exec-lua:` entry points.
//
// The output is the decision input for JAPI pack A/B and for whether S15-S18 are worth their
// cost. It reads the developer's own files and writes nothing unless --out is given.

const { readFileSync, readdirSync, statSync, existsSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const mpqMod = require('mdx-m3-viewer/dist/cjs/parsers/mpq');
const MpqArchive = (mpqMod.default ?? mpqMod).Archive;

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outFile = outAt >= 0 ? args[outAt + 1] : null;
const topAt = args.indexOf('--top');
const TOP = topAt >= 0 ? Number(args[topAt + 1]) || 30 : 30;
const targets = args.filter((a, i) => !a.startsWith('--') && !(outAt >= 0 && i === outAt + 1) && !(topAt >= 0 && i === topAt + 1));

function collect(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return /\.(w3x|w3m)$/i.test(path) ? [path] : [];
  const out = [];
  for (const e of readdirSync(path)) {
    const p = join(path, e);
    if (statSync(p).isDirectory()) out.push(...collect(p));
    else if (/\.(w3x|w3m)$/i.test(e)) out.push(p);
  }
  return out;
}

const text = (bytes) => Buffer.from(bytes).toString('utf8');

const inc = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

const modules = new Map();
const jassModules = new Map();
const japi = new Map();
const unitSlots = new Map();
const maps = targets.flatMap(collect);
const perMap = [];
let execLuaMaps = 0;
let luaMaps = 0;

for (const path of maps) {
  let archive;
  try {
    archive = new MpqArchive();
    archive.load(new Uint8Array(readFileSync(path)), true);
  } catch (err) {
    perMap.push({ map: path, error: `MPQ: ${err.message}` });
    continue;
  }

  const names = archive.getFileNames().filter((n) => /\.(j|lua)$/i.test(n));
  const sources = [];
  for (const name of names) {
    if (!/(^|[\\/])(war3map|scripts[\\/]war3map|.*\.lua)$/i.test(name) && !/\.lua$/i.test(name) && !/war3map\.j$/i.test(name)) continue;
    const entry = archive.get(name);
    if (!entry) continue;
    try { sources.push({ name, text: text(new Uint8Array(entry.arrayBuffer())) }); } catch { /* skip */ }
  }

  const local = { map: path, files: sources.map((s) => s.name), modules: {}, jass: {}, japi: {}, slots: {}, execLua: 0 };
  for (const { name, text: src } of sources) {
    if (/\.lua$/i.test(name)) luaMaps++;
    if (/exec-lua:/i.test(src)) { local.execLua++; execLuaMaps++; }

    for (const m of src.matchAll(/require\s*\(?\s*["']([\w.\-]+)["']/g)) {
      inc(modules, m[1]); local.modules[m[1]] = (local.modules[m[1]] ?? 0) + 1;
    }
    for (const m of src.matchAll(/jass\.([A-Za-z_]\w*)/g)) {
      inc(jassModules, m[1]); local.jass[m[1]] = (local.jass[m[1]] ?? 0) + 1;
    }
    for (const m of src.matchAll(/\b((?:EX|Dz|KK)[A-Z]\w*)\b/g)) {
      inc(japi, m[1]); local.japi[m[1]] = (local.japi[m[1]] ?? 0) + 1;
    }
    for (const m of src.matchAll(/EXSetUnit(?:Integer|Real|String|ArrayString)\s*\(\s*[^,]+,\s*(\d+)/g)) {
      inc(unitSlots, m[1]); local.slots[m[1]] = (local.slots[m[1]] ?? 0) + 1;
    }
  }
  perMap.push(local);
}

const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);

console.log(`maps: ${maps.length}   maps with .lua: ${luaMaps}   maps with exec-lua: ${execLuaMaps}`);
console.log('\nrequire modules:');
for (const [k, n] of top(modules)) console.log(`  ${String(n).padStart(5)}  ${k}`);
console.log('\njass.* modules:');
for (const [k, n] of top(jassModules)) console.log(`  ${String(n).padStart(5)}  ${k}`);
console.log(`\nJAPI names (${japi.size} distinct, top ${TOP}):`);
for (const [k, n] of top(japi)) console.log(`  ${String(n).padStart(5)}  ${k}`);
console.log('\nEXSetUnit* slot indices:');
for (const [k, n] of top(unitSlots)) console.log(`  ${String(n).padStart(5)}  ${k}`);

if (outFile) {
  writeFileSync(outFile, JSON.stringify({
    maps: perMap,
    totals: {
      modules: Object.fromEntries(modules),
      jass: Object.fromEntries(jassModules),
      japi: Object.fromEntries(japi),
      unitSlots: Object.fromEntries(unitSlots),
      luaMaps, execLuaMaps,
    },
  }, null, 2));
  console.log(`\nwrote ${outFile}`);
}
