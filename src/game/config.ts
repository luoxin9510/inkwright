import type { Modifier, RulesConfig } from "./dice";

/**
 * A game's rules as data. Nothing here names a particular game: skills,
 * resources, characters and modifier rules all come from the author's notes.
 */
export interface SkillDef {
  /** Also the ink variable name, so it must be a valid ink identifier. */
  id: string;
  /** Display name; defaults to the id. */
  name?: string;
  /** How this skill speaks when it interjects as an inner voice. */
  voice?: { stance?: string; color?: string };
  /** Highest level (default 6). */
  max?: number;
}

export interface ResourceDef {
  id: string;
  name?: string;
  min: number;
  max: number;
  initial: number;
}

export interface CharacterDef {
  id: string;
  name?: string;
  /** Starting skill levels when played; keys are skill ids. */
  skills: Record<string, number>;
  /** Starting companion resource values when not played; keys are companionResources ids. */
  companion?: Record<string, number>;
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
  /** ink identifiers the generated code uses; override to localize. */
  ink?: Partial<InkNames>;
}

export interface InkNames {
  /** EXTERNAL function the story calls to roll: `检定(技能, 难度)` → band. */
  check: string;
  /** LIST of playable characters. */
  characters: string;
  /** VAR holding the current character. */
  current: string;
  /** Function that loads a character's preset: `选主角(谁)`. */
  select: string;
  /** Parameter names of the generated functions. */
  skillParam: string;
  difficultyParam: string;
  whoParam: string;
}

export const DEFAULT_INK_NAMES: InkNames = {
  check: "检定", characters: "主角", current: "当前主角", select: "选主角",
  skillParam: "技能", difficultyParam: "难度", whoParam: "谁",
};

export function inkNames(config: GameConfig): InkNames {
  return { ...DEFAULT_INK_NAMES, ...config.ink };
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
  if (parts[0] !== "check" || parts.length < 3 || parts.length > 4) return null;
  const [, skill, diff, flag] = parts;
  if (!config.skills.some((s) => s.id === skill)) return null;
  const difficulty = /^\d+$/.test(diff)
    ? Number(diff)
    : Object.prototype.hasOwnProperty.call(config.difficulties ?? {}, diff) ? config.difficulties?.[diff] : undefined;
  if (difficulty === undefined) return null;
  if (flag !== undefined && !RED.has(flag)) return null;
  return { skill, difficulty, red: flag !== undefined };
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

/** Problems that would make the generated ink or the checks misbehave; empty when fine. */
export function validateConfig(config: GameConfig): string[] {
  const problems: string[] = [];
  if (config.rules.kind === "sum") {
    if (config.rules.dice.length === 0 || config.rules.dice.some((d) => !Number.isInteger(d) || d < 2)) {
      problems.push("rules.dice must list dice with at least 2 sides");
    }
  } else if (!Number.isInteger(config.rules.sides) || config.rules.sides < 2) {
    problems.push("rules.sides must be at least 2");
  }
  const seen = new Set<string>();
  const ident = (id: string, what: string) => {
    if (!IDENT.test(id)) problems.push(`${what} "${id}" is not a valid ink identifier`);
    if (seen.has(id)) problems.push(`duplicate id "${id}"`);
    seen.add(id);
  };
  for (const s of config.skills) ident(s.id, "skill");
  for (const r of config.resources) ident(r.id, "resource");
  for (const c of config.characters) ident(c.id, "character");
  // Companion resources only exist as `<resource>_<character>` variables, so their ids may
  // repeat a resource id (fear for the player and for each companion); the generated names
  // are what must not collide.
  const companionIds = new Set<string>();
  for (const r of config.companionResources ?? []) {
    if (!IDENT.test(r.id)) problems.push(`companion resource "${r.id}" is not a valid ink identifier`);
    if (companionIds.has(r.id)) problems.push(`duplicate companion resource id "${r.id}"`);
    companionIds.add(r.id);
  }
  for (const r of config.companionResources ?? []) {
    for (const c of config.characters) ident(`${r.id}_${c.id}`, "generated companion variable");
  }
  for (const n of Object.values(inkNames(config)) as string[]) ident(n, "ink name");
  if (config.characters.length === 0) problems.push("at least one character is needed");
  for (const r of [...config.resources, ...(config.companionResources ?? [])]) {
    if (!(r.min <= r.initial && r.initial <= r.max)) problems.push(`resource "${r.id}": need min <= initial <= max`);
  }
  for (const [name, value] of Object.entries(config.difficulties ?? {})) {
    if (!Number.isInteger(value) || value <= 0) problems.push(`difficulty "${name}" must be a positive integer`);
  }
  const skills = new Map(config.skills.map((s) => [s.id, s]));
  for (const c of config.characters) {
    for (const [id, level] of Object.entries(c.skills)) {
      const s = skills.get(id);
      if (!s) problems.push(`character "${c.id}" has unknown skill "${id}"`);
      else if (level < 0 || level > (s.max ?? 6)) problems.push(`character "${c.id}": ${id} = ${level} is outside 0..${s.max ?? 6}`);
    }
    for (const id of Object.keys(c.companion ?? {})) {
      if (!config.companionResources?.some((r) => r.id === id)) problems.push(`character "${c.id}" has unknown companion resource "${id}"`);
    }
  }
  for (const m of config.modifiers ?? []) {
    if (m.skill !== undefined && !skills.has(m.skill)) problems.push(`modifier for unknown skill "${m.skill}"`);
    if (m.kind === "perStep" && !(m.step > 0)) problems.push(`modifier on "${m.resource}": step must be positive`);
  }
  return problems;
}
