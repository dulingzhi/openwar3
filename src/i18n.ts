// OpenWar3's own words, in more than one language.
//
// **Why this exists at all, when the game is already localized.** Everything past the load gate
// is the INSTALL's language: the menus, tooltips, unit names and sounds all come out of the
// player's own Warcraft III (`UI\FrameDef\GlobalStrings.fdf`, `Units\*Strings.txt` — see
// docs/versions.md for how a localized install's text is decoded). A Chinese install is a Chinese
// game and an English one is an English game, with no work from us.
//
// The load gate is the exception, and it is an exception by construction: it runs BEFORE an
// install is mounted, so there is nothing to read the words out of. It is the one screen where
// OpenWar3 supplies the text itself (src/ui/gate.ts), and the version refusals and download
// failures it shows are ours too (src/vfs/version.ts, src/assets/downloadInstall.ts). Those are
// what this file holds.
//
// The language follows the BROWSER, not the install — which is not a shortcut but the only thing
// that can be known at the moment the screen appears. It also settles the case the install could
// not: a player whose own copy is English but whose browser is Chinese gets a gate they can read
// and then a game in the language they bought. After the gate, the install decides.

/** The languages we have words for. Adding one is a table below and nothing else — the key type
 *  makes a half-filled table a compile error rather than a screen with English in the middle. */
export type Lang = "en" | "zh";

/** The English table is the source of truth for the KEY SET. */
const EN = {
  // --- the load gate itself (src/ui/gate.ts) ---
  "gate.sub.native":
    "Select your Warcraft III (The Frozen Throne {plays}) folder. That version is required — every player has to be on the same game data — and it is checked at every launch. You will only be asked once: the game remembers where it is. Nothing is uploaded; your install is read from your own disk.",
  "gate.sub.browser":
    "Select your Warcraft III (The Frozen Throne {plays}) folder to begin. That version is required — every player has to be on the same game data. The menu is built from the game's own files, so they're loaded first. Nothing is uploaded — your install is read locally in the browser.",
  "gate.load": "Load Game Files",
  "gate.chooseFolder": "Choose Warcraft III Folder",
  "gate.download": "Download game files",
  "gate.cancel": "Cancel",
  "gate.loading": "Loading game data…",
  "gate.loaded": "Data successfully loaded",
  "gate.loadFailed": "Couldn't load that folder: {msg}",
  "gate.linkBad": "The game files link is not one this can download.",
  "gate.connecting": "Connecting…",
  "gate.downloading": "Downloading game files… {received} of {total}",
  "gate.cancelled": "Cancelled.",
  "gate.noFolderChosen": "No folder chosen.",
  "gate.downloadFailed": "Couldn't download the game files: {msg}",
  "gate.noWarcraftFolder": "No Warcraft III folder selected.",
  "gate.noFolder": "No folder selected.",
  "gate.folderGone": "Your Warcraft III folder is no longer at {path}.",

  // --- what the version gate says (src/vfs/version.ts) ---
  "version.plays": "1.30.4 or 1.27",
  "version.wrong":
    "That folder is Warcraft III {version}. OpenWar3 plays {plays} — every player has to be on the same game data, so this is checked every launch.",
  "version.unknown":
    "That folder does not say which Warcraft III it is. OpenWar3 plays {plays} (The Frozen Throne).",
  "version.noData":
    "That folder has no Warcraft III game data in it (no Data folder and no game archives). Select the Warcraft III {plays} folder itself — the one with the game in it.",
  "version.noExe":
    "That folder holds Warcraft III game archives but no readable War3.exe, so OpenWar3 cannot tell which build it is. OpenWar3 plays {plays} — select the folder the game is installed in, the one with War3.exe in it.",

  // --- a failed "Download game files" (src/assets/downloadInstall.ts) ---
  "dl.driveBlocked":
    "Google Drive does not let a web page download its files. Use the desktop app, or a direct link to the .zip.",
  "dl.notAZipPage":
    'That link opened a web page instead of the file. Make sure it is shared with "Anyone with the link".',
  "dl.notAZipRange": "That server does not allow resumable downloads, which this needs.",
  "dl.packed": "{path} is packed with a method this cannot unpack ({method}).",
  "dl.notWhole": "{path} did not unpack whole.",
  "dl.notALink": "That is not a link.",
  "dl.noStorage": "This browser cannot store the game files. Try Chrome or Edge.",
  "dl.quota": "Not enough browser storage: the game files need {need} and {free} is free.",
} as const;

type Key = keyof typeof EN;

/** Every language must carry every key — a missing line is a build error, not an English string
 *  in the middle of a translated screen. */
const ZH: Record<Key, string> = {
  "gate.sub.native":
    "选择你的《魔兽争霸 III:冰封王座》文件夹(版本 {plays})。版本必须一致——所有玩家的游戏数据必须相同——每次启动都会检查。只会询问一次:游戏会记住它的位置。不会上传任何内容;你的安装目录只在本地读取。",
  "gate.sub.browser":
    "选择你的《魔兽争霸 III:冰封王座》文件夹(版本 {plays})即可开始。版本必须一致——所有玩家的游戏数据必须相同。菜单由游戏自身的文件构建,因此需要先加载它们。不会上传任何内容——你的安装目录在浏览器本地读取。",
  "gate.load": "加载游戏文件",
  "gate.chooseFolder": "选择魔兽争霸 III 文件夹",
  "gate.download": "下载游戏文件",
  "gate.cancel": "取消",
  "gate.loading": "正在加载游戏数据……",
  "gate.loaded": "数据加载完成",
  "gate.loadFailed": "无法加载该文件夹:{msg}",
  "gate.linkBad": "游戏文件链接无法下载。",
  "gate.connecting": "正在连接……",
  "gate.downloading": "正在下载游戏文件……{received} / {total}",
  "gate.cancelled": "已取消。",
  "gate.noFolderChosen": "未选择文件夹。",
  "gate.downloadFailed": "无法下载游戏文件:{msg}",
  "gate.noWarcraftFolder": "未选择魔兽争霸 III 文件夹。",
  "gate.noFolder": "未选择文件夹。",
  "gate.folderGone": "你的魔兽争霸 III 文件夹已不在 {path}。",

  "version.plays": "1.30.4 或 1.27",
  "version.wrong":
    "该文件夹是魔兽争霸 III {version}。OpenWar3 支持 {plays}——所有玩家的游戏数据必须相同,因此每次启动都会检查。",
  "version.unknown":
    "该文件夹没有说明自己是哪个版本的魔兽争霸 III。OpenWar3 支持 {plays}(冰封王座)。",
  "version.noData":
    "该文件夹内没有魔兽争霸 III 的游戏数据(既没有 Data 文件夹,也没有游戏归档)。请选择魔兽争霸 III {plays} 的安装目录本身——也就是游戏所在的文件夹。",
  "version.noExe":
    "该文件夹内有魔兽争霸 III 的游戏归档,但没有可读取的 War3.exe,因此 OpenWar3 无法判断它是哪个版本。OpenWar3 支持 {plays}——请选择游戏安装所在的文件夹,即包含 War3.exe 的那个。",

  "dl.driveBlocked": "Google Drive 不允许网页下载其文件。请使用桌面版,或改用指向 .zip 的直接链接。",
  "dl.notAZipPage": "该链接打开的是网页而不是文件。请确认它已设置为“知道链接的任何人”均可访问。",
  "dl.notAZipRange": "该服务器不支持断点续传,而这里需要。",
  "dl.packed": "{path} 使用了本程序无法解包的压缩方式({method})。",
  "dl.notWhole": "{path} 解包后不完整。",
  "dl.notALink": "这不是一个链接。",
  "dl.noStorage": "此浏览器无法存储游戏文件。请改用 Chrome 或 Edge。",
  "dl.quota": "浏览器存储空间不足:游戏文件需要 {need},当前可用 {free}。",
};

const TABLES: Record<Lang, Record<Key, string>> = { en: EN, zh: ZH };

let chosen: Lang | null = null;

/**
 * The language to speak, decided ONCE per page load.
 *
 * `?lang=` wins over the browser, and is worth having for two reasons that are not the same: a
 * deployment whose players are all on one machine's locale can pin it, and any of this can be
 * looked at in a language the tester does not run their browser in — which is the only way to
 * review a translation without changing an OS setting.
 *
 * Otherwise it is the browser's own preference list, in ITS order, and the first language we have
 * a table for wins. A `zh-TW` browser gets Simplified Chinese: the script differs and some words
 * do, but it is far closer than English, and a Traditional table is one entry in `TABLES` away.
 */
export function lang(): Lang {
  if (chosen) return chosen;
  chosen = fromUrl() ?? fromBrowser();
  return chosen;
}

/** Test seam, and what a `?lang=` change would go through if one is ever made live. */
export function setLang(next: Lang): void {
  chosen = next;
}

function fromUrl(): Lang | null {
  if (typeof location === "undefined") return null;
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(location.search).get("lang");
  } catch {
    return null;
  }
  if (!asked) return null;
  const base = asked.toLowerCase().split("-")[0];
  return base === "en" || base === "zh" ? base : null;
}

function fromBrowser(): Lang {
  if (typeof navigator === "undefined") return "en";
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const base = (tag ?? "").toLowerCase().split("-")[0];
    if (base === "en" || base === "zh") return base;
  }
  return "en";
}

/**
 * One line of our own text, in the current language, with `{placeholders}` filled in.
 *
 * A placeholder with no value is left standing rather than blanked: it is a bug in the caller,
 * and `{msg}` on screen says so where an empty string would read as a rendering fault.
 */
export function t(key: Key, params?: Record<string, string | number>): string {
  const table = TABLES[lang()] ?? EN;
  const line = table[key] ?? EN[key];
  if (!params) return line;
  return line.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
