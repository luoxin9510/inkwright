import type { ConfigProblem, ConfigProblemCode } from "./game/config";

export type Language = "zh" | "en";
export type LanguageSetting = "auto" | Language;

type ConfigMessages = Record<ConfigProblemCode, (...args: string[]) => string>;

const configZh: ConfigMessages = {
  noFrontmatter: () => "笔记没有 frontmatter",
  rulesKind: () => 'rules.kind 必须是 "sum" 或 "rollUnder"',
  list: (key) => `${key} 必须是非空列表`,
  shape: (path) => `${path} 的格式不对`,
  dice: () => "rules.dice 要列出每个骰子的面数,至少 2 面",
  sides: () => "rules.sides 至少为 2",
  ident: (id) => `"${id}" 不是合法的 ink 标识符`,
  duplicate: (id) => `标识符 "${id}" 重复`,
  noCharacters: () => "至少要有一个主角",
  resourceRange: (id) => `资源 "${id}":需要 min <= initial <= max`,
  difficulty: (name) => `难度 "${name}" 必须是正整数`,
  unknownSkill: (who, skill) => `主角 "${who}" 有未定义的技能 "${skill}"`,
  skillLevel: (who, skill, level, max) => `主角 "${who}":${skill} = ${level},必须是 0..${max} 的整数`,
  unknownCompanionResource: (who, id) => `主角 "${who}" 有未定义的队友资源 "${id}"`,
  modifierSkill: (skill) => `修正规则指向未定义的技能 "${skill}"`,
  modifierStep: (resource) => `"${resource}" 的修正规则:step 必须为正数`,
  languages: () => "languages 必须是两个不同的语言代码,例如 [zh, en]",
};

const configEn: ConfigMessages = {
  noFrontmatter: () => "the note has no frontmatter",
  rulesKind: () => 'rules.kind must be "sum" or "rollUnder"',
  list: (key) => `${key} must be a non-empty list`,
  shape: (path) => `${path} has the wrong shape`,
  dice: () => "rules.dice must list each die's sides, at least 2",
  sides: () => "rules.sides must be at least 2",
  ident: (id) => `"${id}" is not a valid ink identifier`,
  duplicate: (id) => `duplicate identifier "${id}"`,
  noCharacters: () => "at least one character is needed",
  resourceRange: (id) => `resource "${id}": need min <= initial <= max`,
  difficulty: (name) => `difficulty "${name}" must be a positive integer`,
  unknownSkill: (who, skill) => `character "${who}" has an unknown skill "${skill}"`,
  skillLevel: (who, skill, level, max) => `character "${who}": ${skill} = ${level} must be an integer in 0..${max}`,
  unknownCompanionResource: (who, id) => `character "${who}" has an unknown companion resource "${id}"`,
  modifierSkill: (skill) => `modifier for an unknown skill "${skill}"`,
  modifierStep: (resource) => `modifier on "${resource}": step must be positive`,
  languages: () => "languages must be two different language codes, e.g. [zh, en]",
};

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
  inspector: "变量与访问次数",
  variables: "变量",
  visits: "访问次数",
  none: "(无)",
  turns: (n: number) => `已做出 ${n} 次选择`,
  startFrom: "从这里开始",
  beginning: "开头",
  startedMidway: "从中途开始:开头的代码没有运行,变量是初始值。",
  storyEnded: "故事已经结束,无法继续选择。",
  choiceNotFound: (want: string, available: string[]) => `找不到选项 "${want}"。当前可选:${available.join(" / ") || "(无)"}`,
  graphName: "Knot 图谱",
  openGraph: "打开 knot 图谱",
  fit: "适应窗口",
  openSource: "打开源码",
  playFromHere: "从这里试玩",
  legendVisited: "已访问",
  legendUnreachable: "从开头走不到",
  legendDivert: "跳转",
  legendTunnel: "隧道",
  legendThread: "线程",
  graphStart: "开始",
  graphEnd: "结束",
  noGraph: "打开一个 .ink 文件(或锁定主剧本),编译成功后这里显示 knot 图谱。",
  graphStale: "当前有编译错误,下面是上次编译成功时的图谱。",
  loadFailed: (msg: string) => `读档失败:这个存档可能和当前剧本对不上(${msg})`,
  save: "存档",
  back: "回退一步",
  saves: "存档",
  load: "读取",
  delete: "删除",
  saveName: (n: number) => `存档 ${n}`,
  saved: "已存档:",
  nothingToSave: "现在没有可以存档的进度。",
  saveNotFound: (id: string) => `找不到存档 "${id}"`,
  exportWeb: "导出为网页",
  storyLanguage: "剧本语言",
  untranslated: '这行有文字没写进双语函数(如 双("中文", "English")),切换语言时不会变。',
  emptyTranslation: "双语函数里有一边是空字符串。",
  exported: "已导出网页:",
  exportFailed: "剧本有编译错误,无法导出。",
  character: "主角",
  status: "状态",
  diceLog: "掷骰记录",
  noRolls: "还没有掷过骰子。",
  bands: ["大失败", "失败", "部分成功", "成功", "大成功"],
  redCheck: "一次性",
  unknownSkill: "(未知技能)",
  gameConfigProblem: (p: string) => `游戏配置有问题:${p}`,
  gameConfigUnusable: (p: string) => `游戏配置无法使用,已按普通剧本运行:${p}`,
  configProblem: (p: ConfigProblem): string => configZh[p.code](...p.args),
  generateEngine: "生成游戏引擎 ink",
  engineWritten: "已生成:",
  noGameNote: "当前主剧本旁边没有 game.md。",
  engineNotIncluded: (file: string) => `剧本没有 INCLUDE ${file},游戏的变量和检定函数不会生效。`,
  engineStale: (file: string) => `${file} 和游戏配置不一致,请运行"生成游戏引擎 ink"命令。`,
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
  inspector: "Variables & visits",
  variables: "Variables",
  visits: "Visit counts",
  none: "(none)",
  turns: (n) => `${n} choice${n === 1 ? "" : "s"} made`,
  startFrom: "Start from",
  beginning: "Beginning",
  startedMidway: "Started midway: code before this point did not run; variables have their initial values.",
  storyEnded: "The story has ended; no more choices can be made.",
  choiceNotFound: (want, available) => `No choice matches "${want}". Available: ${available.join(" / ") || "(none)"}`,
  graphName: "Knot graph",
  openGraph: "Open knot graph",
  fit: "Fit",
  openSource: "Open source",
  playFromHere: "Play from here",
  legendVisited: "Visited",
  legendUnreachable: "Not reachable from the start",
  legendDivert: "Divert",
  legendTunnel: "Tunnel",
  legendThread: "Thread",
  graphStart: "Start",
  graphEnd: "End",
  noGraph: "Open a .ink file (or lock a main story); the knot graph appears after a successful compile.",
  graphStale: "There are compile errors; this is the graph from the last successful compile.",
  loadFailed: (msg) => `Could not load: the save may not match the current story (${msg})`,
  save: "Save",
  back: "Undo choice",
  saves: "Saves",
  load: "Load",
  delete: "Delete",
  saveName: (n) => `Save ${n}`,
  saved: "Saved: ",
  nothingToSave: "There is no progress to save right now.",
  saveNotFound: (id) => `No save matches "${id}"`,
  exportWeb: "Export as web page",
  storyLanguage: "Story language",
  untranslated: 'This line has text outside a bilingual call (like 双("中文", "English")), so it will not change with the language.',
  emptyTranslation: "One side of a bilingual call is an empty string.",
  exported: "Exported web page: ",
  exportFailed: "The story has compile errors and cannot be exported.",
  character: "Character",
  status: "Status",
  diceLog: "Dice log",
  noRolls: "No rolls yet.",
  bands: ["Critical failure", "Failure", "Partial success", "Success", "Critical success"],
  redCheck: "one attempt",
  unknownSkill: "(unknown skill)",
  gameConfigProblem: (p) => `Game config problem: ${p}`,
  gameConfigUnusable: (p) => `Game config unusable, playing as a plain story: ${p}`,
  configProblem: (p) => configEn[p.code](...p.args),
  generateEngine: "Generate game engine ink",
  engineWritten: "Written: ",
  noGameNote: "No game.md next to the current main story.",
  engineNotIncluded: (file) => `The story does not INCLUDE ${file}; the game's variables and check function will be missing.`,
  engineStale: (file) => `${file} does not match the game config; run "Generate game engine ink".`,
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

export function stringsFor(lang: Language): Strings {
  return tables[lang];
}

export function T(): Strings {
  return tables[current];
}
