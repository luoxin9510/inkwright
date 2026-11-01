import type { LocalizedText } from "./config";

/**
 * Dice rules: how a skill check is rolled and graded. Three families cover the
 * common tabletop systems; adding another is one more `kind` here.
 *
 * Every system grades into the same five bands, so stories read one number:
 *   0 critical failure · 1 failure · 2 partial success · 3 success · 4 critical success
 */
export type Band = 0 | 1 | 2 | 3 | 4;

export interface SumDiceRules {
  kind: "sum";
  /** Sides of each die, e.g. [6, 6] for 2d6 or [20] for d20; total + skill + modifiers vs difficulty. */
  dice: number[];
  /** Totals this far below the difficulty count as a partial success (default 2; 0 disables). */
  partialBelow?: number;
  /** All dice at their maximum is a critical success and all at 1 a critical failure (default true). */
  naturalCrits?: boolean;
}

export interface RollUnderRules {
  kind: "rollUnder";
  /** One die with this many sides; a roll at or under the skill succeeds (difficulty is ignored). */
  sides: number;
  /** A roll at or under skill / this is a critical success (default 5, CoC's extreme success). */
  criticalDivisor?: number;
  /** Rolls from here up are critical failures (default: the top face only). */
  fumbleFrom?: number;
}

/** A token in a chaos bag: a modifier, or an automatic failure or success; `count` copies in the bag. */
export interface BagToken {
  /** Defaults to the value as text, or to `auto`. */
  id?: string;
  name?: LocalizedText;
  value?: number;
  auto?: "fail" | "success";
  count?: number;
}

/**
 * A chaos bag (Arkham style): one token is drawn and put back; skill + modifiers + its value vs
 * the difficulty, an auto-fail token fails whatever the numbers, an auto-success token is a critical.
 */
export interface BagRules {
  kind: "bag";
  tokens: BagToken[];
  /** Totals this far below the difficulty count as a partial success (default 0: none). */
  partialBelow?: number;
}

export type RulesConfig = SumDiceRules | RollUnderRules | BagRules;

/** The token a check drew, as recorded: its id, value or auto, and (once the engine named it) its name. */
export interface DrawnToken {
  id: string;
  name?: string;
  value?: number;
  auto?: "fail" | "success";
}

export interface Modifier {
  source: string;
  value: number;
}

export interface CheckInput {
  /** The character's level in the skill. */
  level: number;
  difficulty: number;
  modifiers?: Modifier[];
}

export interface CheckResult extends CheckInput {
  band: Band;
  /** Faces rolled; empty when the band was forced. */
  rolls: number[];
  /** Dice total plus skill and modifiers (sum systems); the roll itself for roll-under; skill, modifiers and the token's value for a bag. */
  total: number;
  modifiers: Modifier[];
  /** The token drawn from a chaos bag. */
  token?: DrawnToken;
}

export interface Chance {
  /** Probability of band 3 or 4. */
  success: number;
  /** Probability of each band, index = band. */
  bands: [number, number, number, number, number];
}

/** Uniform random in [0, 1); injectable so tests and explorers can fix the dice. */
export type Rng = () => number;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function gradeSum(rules: SumDiceRules, rolls: number[], bonus: number, difficulty: number): Band {
  if (rules.naturalCrits !== false) {
    if (rolls.every((r, i) => r === rules.dice[i])) return 4;
    if (rolls.every((r) => r === 1)) return 0;
  }
  const total = sum(rolls) + bonus;
  if (total >= difficulty) return 3;
  if (total >= difficulty - (rules.partialBelow ?? 2) && (rules.partialBelow ?? 2) > 0) return 2;
  return 1;
}

/** A token's id as written, else its value as text or its auto kind. */
export function tokenId(t: BagToken): string {
  return t.id ?? t.auto ?? String(t.value ?? 0);
}

/** The bag's tokens, each repeated `count` times, in order. */
export function bagPool(rules: BagRules): BagToken[] {
  return rules.tokens.flatMap((t) => Array.from({ length: Math.max(1, Math.floor(t.count ?? 1)) }, () => t));
}

/** A drawn token as text: its name, else "auto" wording, else its value with a sign. */
export function tokenText(t: DrawnToken, auto: { fail: string; success: string }): string {
  if (t.name) return t.name;
  if (t.auto) return auto[t.auto];
  const v = t.value ?? 0;
  return v > 0 ? `+${v}` : String(v);
}

function gradeBag(rules: BagRules, token: BagToken, bonus: number, difficulty: number): Band {
  if (token.auto === "fail") return 0;
  if (token.auto === "success") return 4;
  const total = bonus + (token.value ?? 0);
  if (total >= difficulty) return 3;
  const partial = rules.partialBelow ?? 0;
  return partial > 0 && total >= difficulty - partial ? 2 : 1;
}

function gradeRollUnder(rules: RollUnderRules, roll: number, skill: number): Band {
  if (roll >= (rules.fumbleFrom ?? rules.sides)) return 0;
  if (roll <= Math.floor(skill / (rules.criticalDivisor ?? 5))) return 4;
  return roll <= skill ? 3 : 1;
}

/** Rolls a check. `force` skips the dice and returns that band, for tools that walk every outcome. */
export function resolve(rules: RulesConfig, input: CheckInput, rng: Rng, force?: Band): CheckResult {
  const modifiers = input.modifiers ?? [];
  const bonus = input.level + sum(modifiers.map((m) => m.value));
  if (force !== undefined) return { ...input, modifiers, band: force, rolls: [], total: 0 };
  if (rules.kind === "bag") {
    const pool = bagPool(rules);
    const t = pool[Math.floor(rng() * pool.length)];
    const token: DrawnToken = { id: tokenId(t), ...(t.value !== undefined ? { value: t.value } : {}), ...(t.auto ? { auto: t.auto } : {}) };
    return { ...input, modifiers, band: gradeBag(rules, t, bonus, input.difficulty), rolls: [], total: bonus + (t.value ?? 0), token };
  }
  if (rules.kind === "sum") {
    const rolls = rules.dice.map((sides) => 1 + Math.floor(rng() * sides));
    return { ...input, modifiers, band: gradeSum(rules, rolls, bonus, input.difficulty), rolls, total: sum(rolls) + bonus };
  }
  const roll = 1 + Math.floor(rng() * rules.sides);
  return { ...input, modifiers, band: gradeRollUnder(rules, roll, bonus), rolls: [roll], total: roll };
}

/** Exact probability of each band, by enumerating the dice. */
export function chance(rules: RulesConfig, input: CheckInput): Chance {
  const bonus = input.level + sum((input.modifiers ?? []).map((m) => m.value));
  const bands: Chance["bands"] = [0, 0, 0, 0, 0];
  if (rules.kind === "bag") {
    const pool = bagPool(rules);
    for (const t of pool) bands[gradeBag(rules, t, bonus, input.difficulty)] += 1 / pool.length;
  } else if (rules.kind === "sum") {
    const count = rules.dice.reduce((a, b) => a * b, 1);
    const walk = (i: number, rolls: number[]) => {
      if (i === rules.dice.length) {
        bands[gradeSum(rules, rolls, bonus, input.difficulty)] += 1 / count;
        return;
      }
      for (let f = 1; f <= rules.dice[i]; f++) walk(i + 1, [...rolls, f]);
    };
    walk(0, []);
  } else {
    for (let roll = 1; roll <= rules.sides; roll++) bands[gradeRollUnder(rules, roll, bonus)] += 1 / rules.sides;
  }
  return { success: bands[3] + bands[4], bands };
}

/**
 * Dice for check number `index` of the run with this seed: each face is a hash of (seed, index,
 * die), so a rebuilt Story (back, load, language replay) rolls the same faces again without
 * replaying a random stream.
 */
export function seededDice(seed: number, index: number): Rng {
  let die = 0;
  return () => {
    let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca77) ^ Math.imul(++die, 0xc2b2ae3d)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
}

/** The expected roll, used by the generated ink fallback when there is no engine to roll. */
export function averageRoll(rules: RulesConfig): number {
  if (rules.kind === "bag") {
    const pool = bagPool(rules);
    return Math.round(sum(pool.map((t) => t.value ?? 0)) / Math.max(1, pool.length)) || 0;
  }
  return rules.kind === "sum" ? sum(rules.dice.map((s) => (s + 1) / 2)) : (rules.sides + 1) / 2;
}

/**
 * A dice formula a story rolls freely, outside any check: `2d6+3`, `d20`, `1d100` (or `d%`),
 * `d66` (two d6 read as tens and units). Count and sides are integers; the bonus may be negative.
 */
export interface DiceFormula {
  count: number;
  sides: number;
  bonus: number;
  /** Two d6 read as tens and units: 11..66. */
  d66: boolean;
}

const FORMULA = /^\s*(\d*)[dD](\d+|%)\s*(?:([+-])\s*(\d+))?\s*$/;

/** Parses `NdM[+K|-K]`, `dM`, `d%` and `d66`; null when the text is not a formula. */
export function parseFormula(text: string): DiceFormula | null {
  const m = FORMULA.exec(text);
  if (!m) return null;
  const [, countText, sidesText, sign, bonusText] = m;
  const bonus = bonusText === undefined ? 0 : (sign === "-" ? -1 : 1) * Number(bonusText);
  if (countText === "" && sidesText === "66") return { count: 2, sides: 6, bonus, d66: true };
  const count = countText === "" ? 1 : Number(countText);
  const sides = sidesText === "%" ? 100 : Number(sidesText);
  if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(sides) || sides < 2) return null;
  return { count, sides, bonus, d66: false };
}

/** The formula as a story would write it: `2d6+3`, `d66`, `1d20-1`. */
export function formatFormula(f: DiceFormula): string {
  const bonus = f.bonus === 0 ? "" : f.bonus > 0 ? `+${f.bonus}` : String(f.bonus);
  return (f.d66 ? "d66" : `${f.count}d${f.sides}`) + bonus;
}

/** Rolls a formula: the faces, and the total with the bonus (tens and units for d66). */
export function rollFormula(f: DiceFormula, rng: Rng): { rolls: number[]; total: number } {
  const rolls = Array.from({ length: f.count }, () => 1 + Math.floor(rng() * f.sides));
  const total = f.d66 ? rolls[0] * 10 + rolls[1] + f.bonus : sum(rolls) + f.bonus;
  return { rolls, total };
}

/** The lowest and highest total the formula can give. */
export function formulaSpan(f: DiceFormula): { min: number; max: number } {
  return f.d66 ? { min: 11 + f.bonus, max: 66 + f.bonus } : { min: f.count + f.bonus, max: f.count * f.sides + f.bonus };
}

/** The expected total, rounded: what the ink fallback returns without an engine to roll. */
export function averageFormula(f: DiceFormula): number {
  const { min, max } = formulaSpan(f);
  return Math.round((min + max) / 2);
}
