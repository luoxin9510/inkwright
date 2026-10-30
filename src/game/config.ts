import type { Modifier, RulesConfig } from "./dice";

/**
 * A game's rules as data. Nothing here names a particular game: skills,
 * resources, characters and modifier rules all come from the author's notes.
 * Ids are code (ink identifiers, tags); what the player reads is a
 * LocalizedText, so a game can show every language its story plays in.
 */

/** Player-facing text: one string, or one per language code (`{ zh: 洞察力, en: Insight }`). */
export type LocalizedText = string | Record<string, string>;

/** The text in `lang`, else the first language given, else `fallback` (usually the id). */
export function localize(text: LocalizedText | undefined | null, lang: string, fallback: string): string {
  if (typeof text === "string") return text;
  if (text && typeof text === "object") return text[lang] ?? Object.values(text)[0] ?? fallback;
  return fallback;
}

export interface SkillDef {
  /** Also the ink variable name, so it must be a valid ink identifier. */
  id: string;
  /** Display name; defaults to the id. */
  name?: LocalizedText;
  /** How this skill speaks when it interjects as an inner voice. */
  voice?: { stance?: LocalizedText; color?: string };
  /** Highest level (default 6). */
  max?: number;
}

export interface ResourceDef {
  id: string;
  name?: LocalizedText;
  min: number;
  max: number;
  initial: number;
}

export interface CharacterDef {
  id: string;
  name?: LocalizedText;
  /** Starting skill levels when played; keys are skill ids. */
  skills: Record<string, number>;
  /** Starting companion resource values when not played; keys are companionResources ids. */
  companion?: Record<string, number>;
  /** False for a companion the player can never pick (default true). */
  playable?: boolean;
}

/** The characters the player can pick. */
export function playableCharacters(config: GameConfig): CharacterDef[] {
  return config.characters.filter((c) => c.playable !== false);
}

/** Modifier rules read the story's state when a check is made. */
export type ModifierRule =
  | {
      kind: "perStep";
      /** For every `step` points of this variable, add `value` (e.g. fear: -1 per 25). */
      resource: string;
      step: number;
      value: number;
      /** Only for this skill; omitted = every skill. */
      skill?: string;
      label?: string;
    }
  | {
      kind: "when";
      variable: string;
      /** Apply when the variable equals this (default true). */
      equals?: string | number | boolean;
      value: number;
      skill?: string;
      label?: string;
    };

export interface GameConfig {
  rules: RulesConfig;
  /** Named difficulties usable in check tags, e.g. { 困难: 12 }. */
  difficulties?: Record<string, number>;
  skills: SkillDef[];
  /** Resources of the played character (fear, stamina, ...). */
  resources: ResourceDef[];
  /** Per-companion resources; variables are named `<resource>_<character>`. */
  companionResources?: ResourceDef[];
  characters: CharacterDef[];
  modifiers?: ModifierRule[];
  /**
   * Languages the story is written in, e.g. ["zh", "en"] (the first is the default). The
   * generated ink then declares the language variable and the text function (`{t("中文", "English")}`).
   */
  languages?: string[];
  /** File the generated ink is written to, next to the main story (default `_engine.ink`). */
  engineFile?: string;
  /** ink identifiers the generated code uses: a preset ("en" is the default, "zh" for Chinese names) or overrides. */
  ink?: InkPreset | Partial<InkNames>;
}

export type InkPreset = "en" | "zh";
export const DEFAULT_ENGINE_FILE = "_engine.ink";
/** A game folder holds its main story and one of these notes, whose frontmatter is the GameConfig. */
export const GAME_NOTE_NAMES = ["game.md", "游戏.md"];

export interface InkNames {
  /** EXTERNAL function the story calls to roll: `检定("技能名", 难度)` → band. */
  check: string;
  /** Generated function mapping a skill's name to its current level, for the ink fallback. */
  skillValue: string;
  /** LIST of playable characters. */
  characters: string;
  /** VAR holding the current character. */
  current: string;
  /** Function that loads a character's preset: `选主角(谁)`. */
  select: string;
  /** VARs the engine writes so the dice follow the state: the run's seed and how many checks it rolled. */
  seed: string;
  rolls: string;
  /** VAR holding the story's language and the function picking text by it (bilingual stories). */
  langVar: string;
  textFn: string;
  /** Parameter names of the generated functions. */
  skillParam: string;
  difficultyParam: string;
  whoParam: string;
}

export const INK_PRESETS: Record<InkPreset, InkNames> = {
  en: {
    check: "check", skillValue: "skill_level", characters: "characters", current: "character", select: "pick_character",
    seed: "dice_seed", rolls: "dice_rolls", langVar: "lang", textFn: "t",
    skillParam: "skill", difficultyParam: "difficulty", whoParam: "who",
  },
  zh: {
    check: "检定", skillValue: "技能值", characters: "主角", current: "当前主角", select: "选主角",
    seed: "骰子种子", rolls: "掷骰次数", langVar: "语言", textFn: "双",
    skillParam: "技能", difficultyParam: "难度", whoParam: "谁",
  },
};
export const DEFAULT_INK_NAMES: InkNames = INK_PRESETS.en;

export function inkNames(config: GameConfig): InkNames {
  return typeof config.ink === "string" ? INK_PRESETS[config.ink] : { ...DEFAULT_INK_NAMES, ...config.ink };
}

/** Where the generated ink lives, relative to the game's folder. */
export function engineFile(config: GameConfig): string {
  return config.engineFile ?? DEFAULT_ENGINE_FILE;
}

export interface CheckTag {
  skill: string;
  difficulty: number;
  /** One attempt only; a white (default) check can be retried once the state changes. */
  red: boolean;
}

const RED = new Set(["red", "红"]);

/** `check:<skill>:<difficulty>[:red]`; difficulty is a number or a name from config.difficulties. */
export function parseCheckTag(tag: string, config: GameConfig): CheckTag | null {
  const parts = tag.trim().split(":").map((p) => p.trim());
  if (parts[0] !== "check" || parts.length < 2 || parts.length > 4) return null;
  const [, skill, ...rest] = parts;
  if (!config.skills.some((s) => s.id === skill)) return null;
  const red = rest.length > 0 && RED.has(rest[rest.length - 1]);
  if (red) rest.pop();
  if (rest.length > 1) return null;
  // Roll-under systems ignore the difficulty, so their tags may leave it out (or write 0).
  const rollUnder = config.rules.kind === "rollUnder";
  if (rest.length === 0) return rollUnder ? { skill, difficulty: 0, red } : null;
  const diff = rest[0];
  const difficulty = /^\d+$/.test(diff)
    ? Number(diff)
    : Object.prototype.hasOwnProperty.call(config.difficulties ?? {}, diff) ? config.difficulties?.[diff] : undefined;
  if (difficulty === undefined || (difficulty <= 0 && !rollUnder)) return null;
  return { skill, difficulty, red };
}

/** `voice:<skill>` → the skill id. */
export function parseVoiceTag(tag: string, config: GameConfig): string | null {
  const parts = tag.trim().split(":").map((p) => p.trim());
  if (parts[0] !== "voice" || parts.length !== 2) return null;
  return config.skills.some((s) => s.id === parts[1]) ? parts[1] : null;
}

/** Reads one story variable by name (e.g. `story.variablesState[name]`). */
export type StateReader = (name: string) => unknown;

/** Compares a story value with a rule's value by text, so bools, ints and strings from inkjs all match. */
function sameValue(actual: unknown, expected: string | number | boolean): boolean {
  // ink functions may hand back 1/0 for true/false.
  if (typeof expected === "boolean" && typeof actual === "number") return (actual !== 0) === expected;
  switch (typeof actual) {
    case "string": case "number": case "boolean": return String(actual) === String(expected);
    // Anything else (an ink list, an object) is compared by its own text form.
    case "object": return actual !== null && typeof (actual as { toString?: unknown }).toString === "function"
      && (actual as { toString: () => string }).toString() === String(expected);
    default: return false;
  }
}

/** Modifiers that apply to a check of `skill` given the current state. */
export function collectModifiers(config: GameConfig, skill: string, state: StateReader): Modifier[] {
  const out: Modifier[] = [];
  for (const rule of config.modifiers ?? []) {
    if (rule.skill !== undefined && rule.skill !== skill) continue;
    if (rule.kind === "perStep") {
      const v = Number(state(rule.resource) ?? 0);
      const steps = Math.floor(v / rule.step);
      if (steps > 0) out.push({ source: rule.label ?? rule.resource, value: rule.value * steps });
    } else if (sameValue(state(rule.variable), rule.equals ?? true)) {
      out.push({ source: rule.label ?? rule.variable, value: rule.value });
    }
  }
  return out;
}

/** ink identifiers: letters (any script), digits and underscores, not starting with a digit. */
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;

export const CONFIG_PROBLEM_CODES = [
  "noFrontmatter", "rulesKind", "list", "shape", "dice", "sides", "ident", "duplicate", "noCharacters",
  "resourceRange", "difficulty", "unknownSkill", "skillLevel", "unknownCompanionResource", "modifierSkill", "modifierStep", "languages",
] as const;
export type ConfigProblemCode = (typeof CONFIG_PROBLEM_CODES)[number];

/** A problem in a game config, as data; the panel words it in the user's language (`T().configProblem`). */
export interface ConfigProblem {
  code: ConfigProblemCode;
  /** What the message names: ids, paths, values. */
  args: string[];
}

/** Problems that would make the generated ink or the checks misbehave; empty when fine. */
export function validateConfig(config: GameConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const bad = (code: ConfigProblemCode, ...args: (string | number)[]) => problems.push({ code, args: args.map(String) });
  if (config.rules.kind === "sum") {
    if (config.rules.dice.length === 0 || config.rules.dice.some((d) => !Number.isInteger(d) || d < 2)) bad("dice");
  } else if (!Number.isInteger(config.rules.sides) || config.rules.sides < 2) {
    bad("sides");
  }
  const seen = new Set<string>();
  const ident = (id: string) => {
    if (!IDENT.test(id)) bad("ident", id);
    if (seen.has(id)) bad("duplicate", id);
    seen.add(id);
  };
  for (const s of config.skills) ident(s.id);
  for (const r of config.resources) ident(r.id);
  for (const c of config.characters) ident(c.id);
  // Companion resources only exist as `<resource>_<character>` variables, so their ids may
  // repeat a resource id (fear for the player and for each companion); the generated names
  // are what must not collide.
  const companionIds = new Set<string>();
  for (const r of config.companionResources ?? []) {
    if (!IDENT.test(r.id)) bad("ident", r.id);
    if (companionIds.has(r.id)) bad("duplicate", r.id);
    companionIds.add(r.id);
  }
  for (const r of config.companionResources ?? []) {
    for (const c of config.characters) ident(`${r.id}_${c.id}`);
  }
  for (const n of Object.values(inkNames(config)) as string[]) ident(n);
  if (config.languages !== undefined && (config.languages.length !== 2 || config.languages[0] === config.languages[1] || !config.languages.every((l) => IDENT.test(l)))) {
    bad("languages");
  }
  if (playableCharacters(config).length === 0) bad("noCharacters");
  for (const r of [...config.resources, ...(config.companionResources ?? [])]) {
    if (!(r.min <= r.initial && r.initial <= r.max)) bad("resourceRange", r.id);
  }
  for (const [name, value] of Object.entries(config.difficulties ?? {})) {
    if (!Number.isInteger(value) || value <= 0) bad("difficulty", name);
  }
  const skills = new Map(config.skills.map((s) => [s.id, s]));
  for (const c of config.characters) {
    for (const [id, level] of Object.entries(c.skills)) {
      const s = skills.get(id);
      if (!s) bad("unknownSkill", c.id, id);
      else if (!Number.isInteger(level) || level < 0 || level > (s.max ?? 6)) bad("skillLevel", c.id, id, level, s.max ?? 6);
    }
    for (const id of Object.keys(c.companion ?? {})) {
      if (!config.companionResources?.some((r) => r.id === id)) bad("unknownCompanionResource", c.id, id);
    }
  }
  for (const m of config.modifiers ?? []) {
    if (m.skill !== undefined && !skills.has(m.skill)) bad("modifierSkill", m.skill);
    if (m.kind === "perStep" && !(m.step > 0)) bad("modifierStep", m.resource);
  }
  return problems;
}

export interface LoadedConfig {
  config: GameConfig | null;
  /** Why the config is unusable (config null) or questionable (config set, problems listed). */
  problems: ConfigProblem[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isScalar = (v: unknown): v is string | number | boolean => isStr(v) || isNum(v) || isBool(v);
const numMap = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every(isNum);
const strMap = (v: unknown): v is Record<string, string> => isObj(v) && Object.values(v).every(isStr);
const isText = (v: unknown): v is LocalizedText => isStr(v) || strMap(v);
const isPreset = (v: unknown): v is InkPreset => v === "en" || v === "zh";
/** Optional field: absent (or an empty YAML value, which parses as null) or of the right type. */
const opt = (v: unknown, check: (x: unknown) => boolean): boolean => v === undefined || v === null || check(v);

/**
 * Reads a GameConfig from parsed frontmatter (any JSON-like value). A wrong shape makes the
 * config unusable (null); a well-formed one still carries validateConfig's problems.
 */
export function readConfig(fm: unknown): LoadedConfig {
  if (!isObj(fm)) return { config: null, problems: [{ code: "noFrontmatter", args: [] }] };
  const problems: ConfigProblem[] = [];
  const shape = (path: string) => problems.push({ code: "shape", args: [path] });
  const rules = fm.rules;
  if (!isObj(rules) || (rules.kind !== "sum" && rules.kind !== "rollUnder")) {
    problems.push({ code: "rulesKind", args: [] });
  } else if (rules.kind === "sum") {
    if (!Array.isArray(rules.dice) || !rules.dice.every(isNum)) shape("rules.dice");
    if (!opt(rules.partialBelow, isNum)) shape("rules.partialBelow");
    if (!opt(rules.naturalCrits, isBool)) shape("rules.naturalCrits");
  } else {
    if (!isNum(rules.sides)) shape("rules.sides");
    if (!opt(rules.criticalDivisor, isNum)) shape("rules.criticalDivisor");
    if (!opt(rules.fumbleFrom, isNum)) shape("rules.fumbleFrom");
  }
  if (!opt(fm.difficulties, numMap)) shape("difficulties");
  if (!opt(fm.ink, (v) => isPreset(v) || strMap(v))) shape("ink");
  if (!opt(fm.languages, (v) => Array.isArray(v) && v.every(isStr))) shape("languages");
  if (!opt(fm.engineFile, (v) => isStr(v) && v.endsWith(".ink") && !v.includes("/"))) shape("engineFile");
  /** A list of entries with an id; `required` lists must be non-empty, optional ones may be absent. */
  const entries = (key: string, required: boolean, check: (e: Record<string, unknown>) => boolean) => {
    const v = fm[key];
    if (v === undefined || v === null) {
      if (required) problems.push({ code: "list", args: [key] });
      return;
    }
    if (!Array.isArray(v) || (required && v.length === 0)) {
      problems.push({ code: required ? "list" : "shape", args: [key] });
      return;
    }
    v.forEach((e: unknown, i) => {
      if (!isObj(e) || !isStr(e.id) || !check(e)) shape(`${key}[${i}]`);
    });
  };
  const resource = (e: Record<string, unknown>) => isNum(e.min) && isNum(e.max) && isNum(e.initial) && opt(e.name, isText);
  const voice = (v: unknown) => isObj(v) && opt(v.stance, isText) && opt(v.color, isStr);
  entries("skills", true, (e) => opt(e.name, isText) && opt(e.max, isNum) && opt(e.voice, voice));
  entries("resources", false, resource);
  entries("companionResources", false, resource);
  entries("characters", true, (e) => opt(e.name, isText) && opt(e.skills, numMap) && opt(e.companion, numMap) && opt(e.playable, isBool));
  const mods = fm.modifiers;
  if (mods !== undefined && mods !== null) {
    if (!Array.isArray(mods)) shape("modifiers");
    else {
      mods.forEach((m: unknown, i) => {
        const ok = isObj(m) && isNum(m.value) && opt(m.skill, isStr) && opt(m.label, isStr)
          && (m.kind === "perStep" ? isStr(m.resource) && isNum(m.step) : m.kind === "when" && isStr(m.variable) && opt(m.equals, isScalar));
        if (!ok) shape(`modifiers[${i}]`);
      });
    }
  }
  if (problems.length > 0) return { config: null, problems };
  const config: GameConfig = {
    rules: rules as RulesConfig,
    difficulties: (fm.difficulties ?? undefined) as GameConfig["difficulties"],
    skills: fm.skills as SkillDef[],
    resources: (fm.resources ?? []) as ResourceDef[],
    companionResources: (fm.companionResources ?? []) as ResourceDef[],
    characters: (fm.characters as CharacterDef[]).map((c) => ({ ...c, skills: c.skills ?? {} })),
    modifiers: (fm.modifiers ?? []) as ModifierRule[],
    languages: (fm.languages ?? undefined) as string[] | undefined,
    engineFile: (fm.engineFile ?? undefined) as string | undefined,
    ink: fm.ink ?? undefined,
  };
  return { config, problems: validateConfig(config) };
}
