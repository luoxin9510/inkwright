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
    const mean = sum(pool.map((t) => t.value ?? 0)) / Math.max(1, pool.length);
    return mean === 0 ? 0 : mean; // never -0
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
  /** `d6!`: a die showing its top face is rolled again and added, as often as it comes up. */
  explode?: boolean;
  /** `4d6kh3` / `2d20kl1`: only the highest (or lowest) `count` faces are added up. Not with `explode` or `pool`. */
  keep?: { high: boolean; count: number };
  /** `5d6>=5`: a dice pool; the total is the number of faces at or above this (plus the bonus). */
  pool?: number;
}

const FORMULA = /^\s*(\d*)[dD](\d+|%)(!?)\s*(?:([kK][hHlL])\s*(\d*))?\s*(?:(?:>=|≥)\s*(\d+))?\s*(?:([+-])\s*(\d+))?\s*$/;

/**
 * Parses `NdM[+K|-K]`, `dM`, `d%`, `d66`, exploding `dM!`, keep highest/lowest `4d6kh3` / `2d20kl` (one die
 * when the number is left out) and dice pools `5d6>=5`; null when the text is not a formula.
 */
export function parseFormula(text: string): DiceFormula | null {
  const m = FORMULA.exec(text);
  if (!m) return null;
  const [, countText, sidesText, bang, keepText, keepCount, poolText, sign, bonusText] = m;
  const bonus = bonusText === undefined ? 0 : (sign === "-" ? -1 : 1) * Number(bonusText);
  if (countText === "" && sidesText === "66") return bang || keepText || poolText ? null : { count: 2, sides: 6, bonus, d66: true };
  const count = countText === "" ? 1 : Number(countText);
  const sides = sidesText === "%" ? 100 : Number(sidesText);
  if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(sides) || sides < 2) return null;
  const f: DiceFormula = { count, sides, bonus, d66: false };
  if (bang) f.explode = true;
  if (keepText) {
    const k = keepCount === "" || keepCount === undefined ? 1 : Number(keepCount);
    if (bang || poolText !== undefined || k < 1 || k > count) return null;
    f.keep = { high: keepText.toLowerCase() === "kh", count: k };
  }
  if (poolText !== undefined) {
    const target = Number(poolText);
    if (target < 1 || target > sides) return null;
    f.pool = target;
  }
  return f;
}

/** The formula as a story would write it: `2d6+3`, `d66`, `1d20-1`, `1d6!`, `4d6kh3`, `5d10!>=8+1`. */
export function formatFormula(f: DiceFormula): string {
  const bonus = f.bonus === 0 ? "" : f.bonus > 0 ? `+${f.bonus}` : String(f.bonus);
  if (f.d66) return "d66" + bonus;
  const keep = f.keep ? `k${f.keep.high ? "h" : "l"}${f.keep.count}` : "";
  const pool = f.pool !== undefined ? `>=${f.pool}` : "";
  return `${f.count}d${f.sides}${f.explode ? "!" : ""}${keep}${pool}${bonus}`;
}

/** Extra dice one exploding die may add, at most: a guard against an rng stuck on the top face. */
const MAX_EXPLOSIONS = 20;

/**
 * Rolls a formula: the faces (an exploding die's extra faces follow it), and the total with the bonus (tens and units
 * for d66; the kept faces for keep highest/lowest; the hits for a pool). `dropped` lists the indices of the faces that
 * do not count (not kept, or missed), only when there are any rules that drop faces.
 */
export function rollFormula(f: DiceFormula, rng: Rng): { rolls: number[]; total: number; dropped?: number[] } {
  const face = () => 1 + Math.floor(rng() * f.sides);
  const rolls: number[] = [];
  for (let i = 0; i < f.count; i++) {
    let r = face();
    rolls.push(r);
    for (let k = 0; f.explode && r === f.sides && k < MAX_EXPLOSIONS; k++) rolls.push((r = face()));
  }
  if (f.keep) {
    // Best faces first; among equal faces the earlier one is kept.
    const keep = f.keep;
    const order = rolls.map((_, i) => i).sort((a, b) => (keep.high ? rolls[b] - rolls[a] : rolls[a] - rolls[b]) || a - b);
    const kept = new Set(order.slice(0, keep.count));
    const dropped = rolls.map((_, i) => i).filter((i) => !kept.has(i));
    return { rolls, total: sum([...kept].map((i) => rolls[i])) + f.bonus, dropped };
  }
  if (f.pool !== undefined) {
    const target = f.pool;
    const dropped = rolls.map((_, i) => i).filter((i) => rolls[i] < target);
    return { rolls, total: rolls.length - dropped.length + f.bonus, dropped };
  }
  const total = f.d66 ? rolls[0] * 10 + rolls[1] + f.bonus : sum(rolls) + f.bonus;
  return { rolls, total };
}

/** The lowest and highest total the formula can give (an exploding die's extra faces aside). */
export function formulaSpan(f: DiceFormula): { min: number; max: number } {
  if (f.d66) return { min: 11 + f.bonus, max: 66 + f.bonus };
  if (f.keep) return { min: f.keep.count + f.bonus, max: f.keep.count * f.sides + f.bonus };
  if (f.pool !== undefined) return { min: f.bonus, max: f.count + f.bonus };
  return { min: f.count + f.bonus, max: f.count * f.sides + f.bonus };
}

/** The expected total, rounded: what the ink fallback returns without an engine to roll. */
export function averageFormula(f: DiceFormula): number {
  // Each top face adds another die: a die is worth s/(s-1) dice on average.
  const grow = f.explode ? f.sides / (f.sides - 1) : 1;
  if (f.pool !== undefined) return Math.round(f.count * grow * ((f.sides - f.pool + 1) / f.sides) + f.bonus);
  if (f.keep) return Math.round(keptMean(f.count, f.sides, f.keep) + f.bonus);
  if (f.explode) return Math.round(f.count * ((f.sides + 1) / 2) * grow + f.bonus);
  const { min, max } = formulaSpan(f);
  return Math.round((min + max) / 2);
}

/**
 * The expected sum of the kept faces of n s-sided dice: the sum of the expected order statistics.
 * The j-th lowest face is at least v when at least n-j+1 dice show v or more.
 */
function keptMean(n: number, s: number, keep: { high: boolean; count: number }): number {
  const choose = (a: number, b: number) => {
    let c = 1;
    for (let i = 1; i <= b; i++) c = (c * (a - b + i)) / i;
    return c;
  };
  const atLeast = (j: number, v: number) => {
    const p = (s - v + 1) / s;
    let total = 0;
    for (let i = n - j + 1; i <= n; i++) total += choose(n, i) * p ** i * (1 - p) ** (n - i);
    return total;
  };
  let mean = 0;
  for (let k = 0; k < keep.count; k++) {
    const j = keep.high ? n - k : k + 1;
    for (let v = 1; v <= s; v++) mean += atLeast(j, v);
  }
  return mean;
}
