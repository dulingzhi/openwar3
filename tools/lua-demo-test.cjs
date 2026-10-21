// The real YD Lua demo maps (docs/lua-engine-implementation.md S0/S18).
//
//   npx tsc -p tools/tsconfig.jass.json
//   node tools/lua-demo-test.cjs [folder]
//
// The folder defaults to `$LUA_DEMO_DIR` or the KKWE3 example maps. If it is absent the test
// SKIPS (exit 0) — it reads the developer's own checkout, never a shipped asset.
//
// What it proves is the DIALECT, not the graphics: each map's `exec-lua:` entry points are
// required in the order its `war3map.j` asks for them, against an interpreter with no
// common.j (so a constant is nil, exactly as it would be on a partial install). Five maps are
// expected to load; two exercise names this port deliberately does not have yet and must fail
// on THAT name, which is the regression guard for "we did not silently swallow a missing
// function".

const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { join, resolve, basename } = require('node:path');

const REPO = resolve(__dirname, '..');
const BUILD = join(REPO, '.jass-build', 'src');
if (!existsSync(join(BUILD, 'compat', 'lua', 'host.js'))) {
  console.error('Build first:  npx tsc -p tools/tsconfig.jass.json');
  process.exit(2);
}

const mpqMod = require('mdx-m3-viewer/dist/cjs/parsers/mpq');
const MpqArchive = (mpqMod.default ?? mpqMod).Archive;

const DEFAULT_DIR = process.env.LUA_DEMO_DIR
  ?? 'F:/Projects/KKWE3/Development/Component/example(演示地图)';
const dirArg = process.argv[2];
const root = dirArg ? resolve(dirArg) : DEFAULT_DIR;
if (!existsSync(root)) {
  console.log(`skip: demo maps not found at ${root}`);
  process.exit(0);
}

const { buildInterpreter } = require(join(BUILD, 'jass', 'headless.js'));
const { createLuaMapScript } = require(join(BUILD, 'compat', 'lua', 'host.js'));

const SEP = String.fromCharCode(92);
const maps = [];
(function walk(p) {
  for (const e of readdirSync(p)) {
    const q = join(p, e);
    if (statSync(q).isDirectory()) walk(q);
    else if (/\.(w3x|w3m)$/i.test(e)) maps.push(q);
  }
})(root);

/** The `.lua` entries of one map, by the name `require` uses (root-relative, forward slashes). */
function luaFiles(mapPath) {
  const archive = new MpqArchive();
  archive.load(new Uint8Array(readFileSync(mapPath)), true);
  const files = new Map();
  for (const n of archive.getFileNames()) {
    if (!/\.lua$/i.test(n)) continue;
    const entry = archive.get(n);
    if (entry) files.set(n.replace(/[\\/]/g, '/'), new Uint8Array(entry.arrayBuffer()));
  }
  return files;
}

let failures = 0;
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${got}${ok ? '' : ` (want ${want})`}`);
};

const CASES = [
  { map: 'Lua-导入外部脚本.w3x', entries: ['runtime_init', 'main'], ok: true },
  { map: 'Lua-计时器-圣光.w3x', entries: ['main'], ok: true },
  { map: 'Lua-Debug.w3x', entries: ['init', 'jass_debug'], ok: true },
  { map: 'Lua-控制台输入.w3x', entries: ['init'], ok: true },
  { map: 'Lua-智能施法.w3x', entries: ['init', 'main'], ok: true },
  // Deliberately out of scope: kkapi's DzLoadToc and the demo plugin's dynamically registered
  // aaa2. A future port of either flips this expectation, on purpose.
  // DzLoadToc now WORKS, so the map gets further and fails on the kkapi-only model-frame
  // API — still out of scope, still by name.
  { map: '界面_ui模型lua测试.w3x', entries: ['test'], ok: false, missing: 'DzFrameAddModel' },
  { map: '自动注册native函数.w3x', entries: ['test_native'], ok: false, missing: 'aaa2' },
];

const found = new Map(maps.map((m) => [basename(m), m]));
for (const c of CASES) {
  const path = found.get(c.map);
  if (!path) { console.log(`skip  ${c.map}: not in ${root}`); continue; }

  let files;
  try { files = luaFiles(path); } catch (err) { console.log(`skip  ${c.map}: ${err.message}`); continue; }
  const map = { rawBytes: (p) => files.get(p.split(SEP).join('/')) ?? files.get(p) ?? null };

  const logs = [];
  const info = console.info, warn = console.warn;
  console.info = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(a.join(' '));
  const interp = buildInterpreter([]);
  const lua = createLuaMapScript(interp, 1, { map, log: (l, t) => logs.push(`${l}: ${t}`) });

  let loaded = 0;
  let failure = null;
  for (const e of c.entries) {
    if (lua.require(e)) loaded++;
    else {
      failure = logs.find((l) => l.includes(e) || l.includes('not found')) ?? 'require failed';
      break;
    }
  }
  console.info = info;
  console.warn = warn;
  lua.dispose();

  if (c.ok) {
    check(`${c.map} loads ${c.entries.join('+')}`, loaded, c.entries.length);
  } else {
    const failedOnName = logs.some((l) => l.includes(c.missing));
    check(`${c.map} fails on ${c.missing} (not silently)`, failedOnName, true);
    if (!failedOnName) console.log('     logs:', logs.slice(-3).join(' | '));
  }
}

console.log(failures === 0 ? '\nall demo expectations hold' : `\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
