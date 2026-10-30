/**
 * Dice rules: how a skill check is rolled and graded. Two families cover the
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

export type RulesConfig = SumDiceRules | RollUnderRules;

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
  /** Dice total plus skill and modifiers (sum systems); the roll itself for roll-under. */
  total: number;
  modifiers: Modifier[];
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
  if (rules.kind === "sum") {
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

/** The expected roll, used by the generated ink fallback when there is no engine to roll. */
export function averageRoll(rules: RulesConfig): number {
  return rules.kind === "sum" ? sum(rules.dice.map((s) => (s + 1) / 2)) : (rules.sides + 1) / 2;
}
