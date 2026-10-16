// `src/i18n.ts` — the language the load gate speaks, and how it is chosen.
//
// **Why this is a headless test and not only a screenshot.** A screenshot with `?lang=zh` proves
// the Chinese TABLE renders. It says nothing about the thing the developer actually asked for —
// that a Chinese BROWSER gets Chinese without being told — because the browser this runs in has
// one locale and it is not the one under test. `lang()` reads `navigator.languages` and
// `location.search`, so both are stubbed here and every branch is driven directly.
//
// Run: pnpm i18n:test   (compiles src/i18n.ts with tools/tsconfig.casc.json first)

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(REPO, ".casc-build");
mkdirSync(BUILD, { recursive: true });
writeFileSync(join(BUILD, "package.json"), '{"type":"commonjs"}');

const require = createRequire(import.meta.url);
const MODULE = join(BUILD, "src", "i18n.js");

let failures = 0;
const ok = (name, pass, detail = "") => {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${pass || !detail ? "" : `  — ${detail}`}`);
  if (!pass) failures++;
};

/**
 * Load the module FRESH, with one browser. `lang()` decides once per page load and caches it, so
 * the cache has to go for the next case — and the honest way to do that is a new module instance,
 * which is exactly what a real second page load is. (No reset API is exported for this: a
 * production `resetLang` that only a test calls is a seam that rots.)
 */
function load({ languages, language, search = "" } = {}) {
  delete require.cache[require.resolve(MODULE)];
  // `defineProperty`, not assignment: Node 24 ships a `navigator` global with only a getter, and
  // a plain `globalThis.navigator = …` throws on it. Configurable so the next case can replace it.
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("navigator", { languages, language: language ?? languages?.[0] });
  define("location", { search });
  const mod = require(MODULE);
  // Resolve the language NOW, while this case's browser is the one installed. `lang()` decides on
  // first use and caches — which is right for a page — so a module left unresolved would read the
  // NEXT case's navigator when it was finally asked, and every case would answer like the last.
  mod.lang();
  return mod;
}

console.log("i18n — the gate's language comes from the browser");
{
  ok("a Simplified-Chinese browser gets Chinese", load({ languages: ["zh-CN"] }).lang() === "zh");
  ok("a Traditional-Chinese browser gets Chinese too", load({ languages: ["zh-TW", "zh"] }).lang() === "zh");
  ok("…and a bare `zh`", load({ languages: ["zh"] }).lang() === "zh");
  ok("an English browser gets English", load({ languages: ["en-US"] }).lang() === "en");
  ok("…and a bare `en`", load({ languages: ["en"] }).lang() === "en");
  ok("the FIRST language we have wins, in the browser's own order",
     load({ languages: ["fr-FR", "zh-CN", "en-US"] }).lang() === "zh");
  ok("a language we do not speak falls back to English", load({ languages: ["ja-JP", "ko-KR"] }).lang() === "en");
  ok("`navigator.language` is used when the list is empty",
     load({ languages: [], language: "zh-CN" }).lang() === "zh");
  ok("no browser at all is not a crash", load({}).lang() === "en");

  // `?lang=` — the escape hatch, and the only way to LOOK at a translation without changing an
  // OS setting. It wins over the browser, and an unknown value is ignored rather than obeyed.
  ok("`?lang=zh` overrides an English browser", load({ languages: ["en-US"], search: "?lang=zh" }).lang() === "zh");
  ok("`?lang=en` overrides a Chinese browser", load({ languages: ["zh-CN"], search: "?lang=en" }).lang() === "en");
  ok("`?lang=zh-CN` is understood as `zh`", load({ languages: ["en-US"], search: "?lang=zh-CN" }).lang() === "zh");
  ok("an unknown `?lang=de` is ignored, not obeyed", load({ languages: ["zh-CN"], search: "?lang=de" }).lang() === "zh");
  ok("…and `?lang=` empty is ignored", load({ languages: ["zh-CN"], search: "?lang=" }).lang() === "zh");
  ok("a query string it cannot parse is not fatal", load({ languages: ["zh-CN"], search: "%%%" }).lang() === "zh");
}

console.log("\ni18n — the words themselves");
{
  const zh = load({ languages: ["zh-CN"] });
  const en = load({ languages: ["en"] });

  ok("the same key reads differently in the two", zh.t("gate.cancel") !== en.t("gate.cancel"),
     `${zh.t("gate.cancel")} / ${en.t("gate.cancel")}`);
  ok("Chinese renders as Chinese", zh.t("gate.load") === "加载游戏文件", zh.t("gate.load"));
  ok("English is unchanged from the shipped copy", en.t("gate.load") === "Load Game Files", en.t("gate.load"));

  // Placeholders, in both tables — a translation that dropped `{plays}` would silently lose the
  // requirement, which is the one thing this screen exists to state.
  const subZh = zh.t("gate.sub.browser", { plays: zh.t("version.plays") });
  const subEn = en.t("gate.sub.browser", { plays: en.t("version.plays") });
  ok("a placeholder is filled (zh)", subZh.includes("1.30.4 或 1.27"), subZh.slice(0, 40));
  ok("a placeholder is filled (en)", subEn.includes("1.30.4 or 1.27"), subEn.slice(0, 40));
  ok("…and no placeholder is left standing", !/\{\w+\}/.test(subZh) && !/\{\w+\}/.test(subEn));
  ok("the `or` between the builds is localized, not hardcoded",
     zh.t("version.plays") !== en.t("version.plays"));

  ok("two placeholders fill in one line",
     zh.t("gate.downloading", { received: "1.2 GB", total: "3.4 GB" }).includes("1.2 GB") &&
     zh.t("gate.downloading", { received: "1.2 GB", total: "3.4 GB" }).includes("3.4 GB"));
  ok("a missing value leaves its placeholder visible rather than blanking it",
     zh.t("gate.loadFailed", {}).includes("{msg}"), zh.t("gate.loadFailed", {}));

  // A smoke test over the whole key set rather than a hand-picked few: every key the gate can
  // reach must actually read differently in Chinese. A table wired up but never consulted — the
  // shape of the bug this whole file exists to catch — shows up here as a pile of identical pairs.
  const KEYS = [
    "gate.load", "gate.chooseFolder", "gate.download", "gate.cancel", "gate.loading", "gate.loaded",
    "gate.loadFailed", "gate.linkBad", "gate.connecting", "gate.downloading", "gate.cancelled",
    "gate.noFolderChosen", "gate.downloadFailed", "gate.noWarcraftFolder", "gate.noFolder",
    "gate.folderGone", "gate.sub.native", "gate.sub.browser",
    "version.plays", "version.wrong", "version.unknown", "version.noData", "version.noExe",
    "dl.driveBlocked", "dl.notAZipPage", "dl.notAZipRange", "dl.packed", "dl.notWhole",
    "dl.notALink", "dl.noStorage", "dl.quota",
  ];
  const same = KEYS.filter((k) => zh.t(k) === en.t(k));
  ok(`all ${KEYS.length} keys are translated`, same.length === 0, same.join(", "));
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall i18n checks passed");
