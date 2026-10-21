// DzAPI P1 — values, system, text tags, unit DB, effects and selection.
//
//   npx tsc -p tools/tsconfig.jass.json
//   node tools/dzapi-p1-test.cjs
//
// Headless: a synthetic interpreter plus a fake EngineHooks table, so this checks the JAPI
// translation and the hook calls without an install or a renderer. The declarations are the
// generated dzapi-decl.ts (P0); this proves the P1 packs replace their typed defaults.

const { writeFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO = resolve(__dirname, '..');
const BUILD = join(REPO, '.jass-build', 'src');
if (!existsSync(join(BUILD, 'compat', 'lua', 'japi', 'dzapi', 'index.js'))) {
  console.error('Build first:  npx tsc -p tools/tsconfig.jass.json');
  process.exit(2);
}
writeFileSync(join(REPO, '.jass-build', 'package.json'), '{"type":"commonjs"}');

const { buildInterpreter } = require(join(BUILD, 'jass', 'headless.js'));
const { createLuaMapScript } = require(join(BUILD, 'compat', 'lua', 'host.js'));
const { jHandle, jInt } = require(join(BUILD, 'jass', 'values.js'));
const { fireDzInput } = require(join(BUILD, 'game', 'dzInput.js'));

let failures = 0;
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${got}${ok ? '' : ` (want ${want})`}`);
};

const src = `globals
    boolean fired = false
endglobals
function Fire takes nothing returns nothing
    set fired = true
endfunction`;
const interp = buildInterpreter([src]);
const rt = interp.rt;
const calls = [];
const BS = String.fromCharCode(92);
let font = "";
let fxColor = 0x123456, fxAlpha = 200;
rt.hooks = {
  showMessage: (t) => calls.push(["log", t]),
  locale: () => "zhCN",
  mapFilePath: () => `Maps${BS}Test.w3x`,
  removePlayerTechResearched: (p, t, n) => calls.push(["tech", p, t, n]),
  setUnitName: (id, name, proper) => calls.push(["name", id, name, proper]),
  setUnitDbField: (id, f, v) => calls.push(["db", id, f, v]),
  textTagFont: () => font,
  setTextTagFont: (f) => { font = f; },
  setSpecialEffectPosition: (id, x, y, z) => calls.push(["pos", id, x, y, z]),
  setSpecialEffectScale: (id, s) => calls.push(["scale", id, s]),
  setSpecialEffectVisible: (id, v) => calls.push(["vis", id, v]),
  setSpecialEffectModel: (id, p) => calls.push(["model", id, p]),
  setSpecialEffectSequence: (id, i, f) => calls.push(["seq", id, i, f]),
  playSpecialEffect: (id, a) => calls.push(["play", id, a]),
  specialEffectSubAnim: (id, t, a) => calls.push(["tag", id, t, a]),
  setSpecialEffectColor: (id, r, g, b) => calls.push(["color", id, r, g, b]),
  setSpecialEffectAlpha: (id, a) => calls.push(["alpha", id, a]),
  specialEffectColor: () => fxColor,
  specialEffectAlpha: () => fxAlpha,
  setSpecialEffectTeamColor: (id, c) => calls.push(["team", id, c]),
  playerColor: (p) => p + 1,
  bindSpecialEffect: (id, u, at) => calls.push(["bind", id, u, at]),
  unbindSpecialEffect: (id) => calls.push(["unbind", id]),
  localSelection: () => [jHandle(11, "unit"), jHandle(22, "unit")],
  localLeader: () => jHandle(22, "unit"),
  setWidgetMinimapIcon: (id, p) => calls.push(["icon", id, p]),
  setWidgetMinimapIconEnabled: (id, e) => calls.push(["iconOn", id, e]),
};
const group = { handleId: 0, units: new Set([11, 22]) };
const gid = rt.handles.alloc(group); group.handleId = gid;
const player = { index: 3, handleId: 0 };
const pid = rt.handles.alloc(player); player.handleId = pid;
const unit = { handleId: 0, player: 0, typeId: "hfoo", x: 0, y: 0, facing: 0, simId: 7 };
const uid = rt.handles.alloc(unit); unit.handleId = uid;
const effect = { engineId: 42, handleId: 0 };
const eid = rt.handles.alloc(effect); effect.handleId = eid;

const lua = createLuaMapScript(interp, 1);
lua.load(`
local J = require "jass.japi"
function strings()
  return tostring(J.DzStringContains("Hello", "EL", false)) .. ":"
    .. J.DzStringFind("aXbXc", "X", 2, true) .. ":"
    .. J.DzStringTrim("  hi  ") .. ":"
    .. J.DzStringReverse("abc") .. ":"
    .. J.DzStringReplace("a-B-b", "b", "X", false) .. ":"
    .. J.DzStringInsert("abc", 1, "XY")
end
function bits() return J.DzBitToInt(0x44, 0x33, 0x22, 0x11) .. ":" .. J.DzBitGetByte(0x11223344, 2) end
function groups(g) return J.DzGroupGetCount(g) .. ":" .. GetHandleId(J.DzGroupGetUnitAt(g, 0)) end
function sys() return J.DzGetLocale() .. ":" .. J.DzGetMapFilePath() end
function exec() J.DzExecuteFunc("Fire") end
function didFire() return fired end
function tags()
  local t = CreateTextTag()
  J.DzTextTagSetFont("Fonts/FRIZQT__.TTF")
  J.DzTextTagSetStartAlpha(t, 128)
  J.DzTextTagSetShadowColor(t, 0xFF112233)
  return J.DzTextTagGetFont() .. ":" .. J.DzTextTagGetStartAlpha(t) .. ":" .. J.DzTextTagGetShadowColor(t)
end
function names(u) J.DzSetUnitName(u, "Footman") J.DzSetUnitProperName(u, "Bob") end
function db(u) J.DzSetUnitPortrait(u, "p.mdx") J.DzSetUnitCollisionSize(u, 32.0) J.DzSetUnitMissileHoming(u, true) end
function fx(e)
  J.DzSetEffectPos(e, 10.0, 20.0, 30.0)
  J.DzSetEffectScale(e, 2.0)
  J.DzSetEffectVisible(e, false)
  J.DzSetEffectModel(e, "m.mdx")
  J.DzSetEffectAnimation(e, 3, 1)
  J.DzPlayEffectAnimation(e, "stand", "alternate,upgrade")
  J.DzSetEffectVertexColor(e, 0x112233)
  J.DzSetEffectVertexAlpha(e, 128)
  J.DzSetEffectTeamColor(e, 5)
end
function fxGets(e) return J.DzGetEffectVertexColor(e) .. ":" .. J.DzGetEffectVertexAlpha(e) end
function bind(w, e) J.DzBindEffect(w, "overhead,left", e) J.DzUnbindEffect(e) end
function sel() return J.DzGetLocalSelectUnitCount() .. ":" .. GetHandleId(J.DzGetLocalSelectUnit(1)) .. ":" .. GetHandleId(J.DzGetSelectedLeaderUnit()) end
function icon(u) J.DzWidgetSetMinimapIcon(u, "x.blp") J.DzWidgetSetMinimapIconEnable(u, true) end
function tech(ph) J.DzRemovePlayerTechResearched(ph, FourCC("Rhme"), 2) end
function frames()
  local ui = J.DzGetGameUI()
  local f = J.DzCreateFrameByTagName("FRAME", "test", ui, "", 0)
  J.DzFrameSetPoint(f, 4, ui, 4, 0.1, 0.2)
  J.DzFrameSetSize(f, 0.3, 0.4)
  J.DzFrameSetText(f, "hi")
  J.DzFrameAddText(f, "!")
  J.DzFrameSetAlpha(f, 180)
  J.DzFrameSetEnable(f, false)
  J.DzFrameSetTextColor(f, 0xFF112233)
  J.DzFrameSetTextSizeLimit(f, 99)
  J.DzFrameSetPriority(f, 7)
  J.DzFrameShow(f, false)
  local found = J.DzFrameFindByName("test", 0)
  return ui > 0 and f > 0
    and math.abs(J.DzFrameGetWidth(f) - 0.3) < 1e-6
    and math.abs(J.DzFrameGetHeight(f) - 0.4) < 1e-6
    and J.DzFrameGetText(f) == "hi!"
    and J.DzFrameGetAlpha(f) == 180
    and J.DzFrameGetEnable(f) == false
    and J.DzFrameGetTextSizeLimit(f) == 99
    and J.DzFrameGetPriority(f) == 7
    and J.DzFrameIsVisible(f) == false
    and J.DzFrameGetPointValid(f, 4) == true
    and math.abs(J.DzFrameGetPointX(f, 4) - 0.1) < 1e-6
    and J.DzFrameGetParent(f) == ui
    and found == f
    and J.DzGetColor(255, 0x11, 0x22, 0x33) == -15654349
end
function frameChildren()
  local ui = J.DzGetGameUI()
  J.DzCreateFrameByTagName("FRAME", "c1", ui, "", 0)
  J.DzCreateFrameByTagName("FRAME", "c2", ui, "", 0)
  return J.DzFrameGetChildrenCount(ui) >= 2
end
keySeen, frameSeen = -1, -1
function onKey() keySeen = J.DzGetTriggerKey() end
function onClick() frameSeen = J.DzGetTriggerUIEventFrame() end
function upd() end
function registerInput()
  J.DzTriggerRegisterKeyEvent(nil, 65, 1, false, "onKey")
  J.DzTriggerRegisterSyncData(nil, "p", false)
  local f = J.DzCreateFrameByTagName("BUTTON", "b", J.DzGetGameUI(), "", 0)
  J.DzFrameSetScriptByCode(f, 1, onClick, false)
  J.DzFrameSetUpdateCallback("upd")
  J.DzFrameSetModel(f, "m.mdx", 1, 0)
  J.DzFrameSetAnimate(f, 2, true)
  return f
end
function seen() return keySeen .. ":" .. frameSeen end
`, "dzapi-p1.lua");

const call = (n, args) => interp.callFunction(n, args ?? []);
const find = (k) => calls.find((c) => c[0] === k);

check("strings", call("strings").s, "true:3:hi:cba:a-X-X:aXYbc");
check("bits", call("bits").s, "287454020:34");
check("groups", call("groups", [jHandle(gid, "group")]).s, "2:11");
check("locale + map path", call("sys").s, `zhCN:maps${BS}test.w3x`);
call("exec");
check("DzExecuteFunc", call("didFire").b, true);
check("text tags", call("tags").s, `Fonts/FRIZQT__.TTF:128:${0xFF112233 | 0}`);
call("names", [jHandle(uid, "unit")]);
check("unit name", JSON.stringify(calls.find((c) => c[0] === "name")), JSON.stringify(["name", 7, "Footman", false]));
call("db", [jHandle(uid, "unit")]);
check("unit db", JSON.stringify(find("db")), JSON.stringify(["db", 7, "portrait", "p.mdx"]));
call("fx", [jHandle(eid, "effect")]);
check("effect pos ignores z", JSON.stringify(find("pos")), JSON.stringify(["pos", 42, 10, 20, null]));
check("effect scale", JSON.stringify(find("scale")), JSON.stringify(["scale", 42, 2]));
check("effect visible", JSON.stringify(find("vis")), JSON.stringify(["vis", 42, false]));
check("effect model", JSON.stringify(find("model")), JSON.stringify(["model", 42, "m.mdx"]));
check("effect sequence", JSON.stringify(find("seq")), JSON.stringify(["seq", 42, 3, 1]));
check("effect link tags", calls.filter((c) => c[0] === "tag").length, 2);
check("effect color", JSON.stringify(find("color")), JSON.stringify(["color", 42, 0x11, 0x22, 0x33]));
check("effect alpha", JSON.stringify(find("alpha")), JSON.stringify(["alpha", 42, 128]));
check("effect team color", JSON.stringify(find("team")), JSON.stringify(["team", 42, 6]));
check("effect getters", call("fxGets", [jHandle(eid, "effect")]).s, `${fxColor}:${fxAlpha}`);
call("bind", [jHandle(uid, "unit"), jHandle(eid, "effect")]);
check("bind", JSON.stringify(find("bind")), JSON.stringify(["bind", 42, 7, ["overhead", "left"]]));
check("unbind", JSON.stringify(find("unbind")), JSON.stringify(["unbind", 42]));
check("selection", call("sel").s, "2:22:22");
call("icon", [jHandle(uid, "unit")]);
check("minimap icon", JSON.stringify(find("icon")), JSON.stringify(["icon", 7, "x.blp"]));
call("tech", [jHandle(pid, "player")]);
check("tech removal", JSON.stringify(find("tech")), JSON.stringify(["tech", 3, "Rhme", 2]));
check("frame core flow", call("frames").b, true);
check("frame children", call("frameChildren").b, true);

const frameId = call("registerInput").n;
fireDzInput(rt, interp, { kind: "key", key: 65, status: 1, player: 0 });
check("Dz input trigger", call("seen").s, "65:-1");
interp.fireFrameEvent(frameId, 1, 0);
check("Dz frame script", call("seen").s, `65:${frameId}`);
check("Dz update callback", rt.frameUpdateCallback?.k, "code");
check("Dz sync registration", rt.dzSyncRegs.length, 1);
const frameObj = rt.handles.get(frameId);
check("Dz frame model", frameObj.modelPath, "m.mdx");
check("Dz frame animate", frameObj.animateIndex, 2);

lua.dispose();
console.log(failures === 0 ? "\nDzAPI P1: all checks pass" : `\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
