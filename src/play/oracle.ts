import { ODDS, localize, type Odds, type OracleConfig, type TableDef } from "../game/config";

export { ODDS, type Odds, type OracleConfig };
import { formatFormula, parseFormula, rollFormula, type Rng } from "../game/dice";
import { rowAt, tableFormula } from "../game/tables";

/**
 * The player's dice tray (solo PRD §4.3): yes/no questions to an oracle, free rolls, inspiration tables.
 * Pure: the panel keeps what comes out as an action of the run, so nothing here is rolled twice.
 */

/** Our own default: a d100 at or under the threshold is a yes. */
export const DEFAULT_ODDS: Record<Odds, number> = { certain: 90, likely: 75, even: 50, unlikely: 25, remote: 10 };

export interface OracleRules {
  odds: Record<Odds, number>;
  /** What the chaos resource adds to every threshold now. */
  shift: number;
}

export interface OracleResult {
  roll: number;
  threshold: number;
  answer: "yes" | "no";
  /** "Yes, and" / "no, and": the lowest fifth of the yeses, the top fifth of the nos. */
  extreme: boolean;
}

/** The thresholds in force: the config's over the defaults, moved by the chaos resource (read now) when there is one. */
export function oracleRules(config: OracleConfig | undefined, read: (id: string) => unknown, chaosRange?: { min: number; max: number }): OracleRules {
  const odds = { ...DEFAULT_ODDS };
  for (const k of ODDS) {
    const v = config?.odds?.[k];
    if (typeof v === "number" && Number.isFinite(v)) odds[k] = v;
  }
  let shift = 0;
  if (config?.chaos && chaosRange) {
    const value = Number(read(config.chaos));
    if (Number.isFinite(value)) shift = (value - (chaosRange.min + chaosRange.max) / 2) * (config.chaosStep ?? 5);
  }
  return { odds, shift };
}

/** A question's threshold: its odds moved by chaos, kept within 1..99 (always a chance either way). */
export function thresholdFor(odds: Odds, rules: OracleRules): number {
  return Math.min(99, Math.max(1, Math.round(rules.odds[odds] + rules.shift)));
}

export function askOracle(odds: Odds, rules: OracleRules, rng: Rng): OracleResult {
  const roll = 1 + Math.floor(rng() * 100);
  const threshold = thresholdFor(odds, rules);
  const yes = roll <= threshold;
  const extreme = yes ? roll <= Math.round(threshold / 5) : roll > 100 - Math.round((100 - threshold) / 5);
  return { roll, threshold, answer: yes ? "yes" : "no", extreme };
}

export interface TrayRoll {
  formula: string;
  rolls: number[];
  total: number;
  dropped?: number[];
  table?: { id: string; name: string; text: string; rowId?: string };
}

/** A roll from the tray: a formula (as `roll()` reads it), or a table's dice and the row they land on; null when the formula cannot be read. */
export function rollTray(formula: string | undefined, spec: { table: TableDef; language: string } | undefined, rng: Rng): TrayRoll | null {
  const f = spec ? tableFormula(spec.table) : parseFormula(formula ?? "");
  if (!f) return null;
  const { rolls, total, dropped } = rollFormula(f, rng);
  const out: TrayRoll = { formula: formatFormula(f), rolls, total, ...(dropped && dropped.length > 0 ? { dropped } : {}) };
  if (spec) {
    const hit = rowAt(spec.table, total);
    out.table = {
      id: spec.table.id, name: localize(spec.table.name, spec.language, spec.table.id),
      text: hit ? localize(hit.row.text, spec.language, "") : "", ...(hit?.row.id !== undefined ? { rowId: hit.row.id } : {}),
    };
  }
  return out;
}
