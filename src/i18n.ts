export type Language = "zh" | "en";
export type LanguageSetting = "auto" | Language;

const zh = {
  editorName: "Ink 剧本",
  playName: "Ink 试玩",
  openPlay: "打开试玩面板",
  lockCurrent: "将当前文件锁定为主剧本",
  unlock: "解除主剧本锁定",
  restart: "重新开始",
  lock: "锁定为主剧本",
  unlockShort: "解除锁定",
  noRoot: "请先打开一个 .ink 文件,或锁定一个主剧本。",
  ended: "— 故事结束 —",
  errors: "编译问题",
  lockNotInk: "当前文件不是 .ink 文件。",
  locked: "已锁定主剧本:",
  unlocked: "已解除主剧本锁定。",
  fileMissing: "文件不存在:",
  lineAt: (n: number) => `第 ${n} 行`,
  rootLine: (root: string, locked: boolean) => `主剧本:${root}${locked ? "(已锁定)" : ""}`,
  missingRoot: (path: string) => `找不到主剧本:${path}`,
  todo: (text: string) => `待办:${text}`,
  infiniteLoop: (seconds: number) => `剧本可能存在无限循环,已在 ${seconds} 秒后停止运行。`,
  settingLanguage: "界面语言",
  settingLanguageDesc: "命令面板里的命令名需要重新加载插件后才会更新。",
  followObsidian: "跟随 Obsidian",
};

export type Strings = typeof zh;

const en: Strings = {
  editorName: "Ink story",
  playName: "Ink player",
  openPlay: "Open player",
  lockCurrent: "Lock current file as main story",
  unlock: "Unlock main story",
  restart: "Restart",
  lock: "Lock as main story",
  unlockShort: "Unlock",
  noRoot: "Open a .ink file, or lock a main story.",
  ended: "— The End —",
  errors: "Problems",
  lockNotInk: "The current file is not a .ink file.",
  locked: "Main story locked: ",
  unlocked: "Main story unlocked.",
  fileMissing: "File not found: ",
  lineAt: (n) => `line ${n}`,
  rootLine: (root, locked) => `Main story: ${root}${locked ? " (locked)" : ""}`,
  missingRoot: (path) => `Main story not found: ${path}`,
  todo: (text) => `TODO: ${text}`,
  infiniteLoop: (seconds) => `The story seems to be stuck in an infinite loop; stopped after ${seconds} s.`,
  settingLanguage: "Interface language",
  settingLanguageDesc: "Command names in the command palette update after reloading the plugin.",
  followObsidian: "Follow Obsidian",
};

const tables: Record<Language, Strings> = { zh, en };
let current: Language = "zh";

/** Chinese (simplified or traditional) gets Chinese; every other locale gets English. */
export function pickLanguage(locale: string): Language {
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** "auto" follows Obsidian's locale; an explicit choice wins. */
export function resolveLanguage(setting: LanguageSetting, locale: string): Language {
  return setting === "auto" ? pickLanguage(locale) : setting;
}

export function setLanguage(lang: Language): void {
  current = lang;
}

export function getLanguage(): Language {
  return current;
}

export function T(): Strings {
  return tables[current];
}
