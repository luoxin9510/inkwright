import { T } from "../i18n";
import { tokenText } from "../game/dice";
import type { CheckRecord, ChoicePlay, DiceRecord } from "../game/engine";
import type { OracleResult } from "./oracle";
import type { PlacedAside } from "./session";

/**
 * The words the play panel puts on its cards, notes and logs, worked out without the DOM so the panel's
 * two places that show a roll (the card in the text, the dice log) say the same thing.
 */

/** What free dice were rolled for: the deck drawn from, the record picked from, the table and formula, or the formula. */
export function diceLabel(r: DiceRecord): string {
  return r.deck ? r.deck.name : r.record ? r.record.name : r.table ? `${r.table.name} ${r.formula}` : r.formula;
}

/** What free dice came out as: the card drawn, the entry picked, the table's row; undefined for plain dice. */
export function diceResult(r: DiceRecord): string | undefined {
  return r.deck ? r.deck.card : r.record ? r.record.entry : r.table?.text;
}

/** A check's skill (by its name) and difficulty. */
export function checkLabel(r: CheckRecord, skills: { id: string; name: string }[]): string {
  const name = r.unknown ? `${r.skill} ${T().unknownSkill}` : skills.find((k) => k.id === r.skill)?.name ?? r.skill;
  return `${name} ${r.difficulty}`;
}

/** A check's modifiers as they are added: ` +1 -2`. */
export function modsText(modifiers: { value: number }[]): string {
  return modifiers.map((m) => ` ${m.value > 0 ? "+" : ""}${m.value}`).join("");
}

/** A check's sum as the card shows it: `+level mods = total`. */
export function checkSum(r: CheckRecord): string {
  return `+${r.level}${modsText(r.modifiers)} = ${r.total}`;
}

/** A chaos-bag token drawn for a check, named or by its value; null for dice. */
export function tokenOf(r: CheckRecord): string | null {
  return r.token ? tokenText(r.token, { fail: T().autoFail, success: T().autoSuccess }) : null;
}

/** One roll as a line of the dice log: what it was for, and what came out. */
export function logLine(r: CheckRecord | DiceRecord, skills: { id: string; name: string }[]): [string, string] {
  const t = T();
  if (r.kind === "dice") {
    const dice = r.rolls.length > 0 ? r.rolls.join("+") : "—";
    const result = diceResult(r);
    return [diceLabel(r), r.unknown ? t.badFormula : `${dice} = ${r.total}${result !== undefined ? ` · ${result}` : ""}`];
  }
  const dice = tokenOf(r) ?? (r.rolls.length > 0 ? r.rolls.join("+") : "—");
  return [checkLabel(r, skills), `${dice} ${checkSum(r)} · ${t.bands[r.band]} (${Math.round(r.chance.success * 100)}%)`];
}

export type StopReason = "mismatch" | "error" | "budget" | "start" | "character" | "chosen";

export interface StopView {
  reason: StopReason;
  step: number;
  pending: number;
  detail?: string;
  older?: boolean;
}

/** Each way a run stops short, worded. */
const STOPPED: Record<StopReason, (s: StopView) => string> = {
  start: (s) => T().stoppedStart(s.detail ?? ""),
  character: (s) => T().stoppedCharacter(s.detail ?? ""),
  budget: (s) => T().stoppedBudget(s.step, s.pending),
  error: (s) => T().stoppedError(s.step, s.pending),
  chosen: (s) => T().stoppedHere(s.step, s.pending),
  mismatch: (s) => T().stoppedMismatch(s.step, s.pending),
};

/** Where and why a run stopped short, and what the player can do about it. */
export function describeStop(s: StopView): { text: string; byIndex: boolean; older: boolean } {
  return {
    text: STOPPED[s.reason](s),
    // Taking the rest by index makes sense where a choice did not match, not where the story itself is missing a start.
    byIndex: s.pending > 0 && (s.reason === "mismatch" || s.reason === "chosen"),
    older: s.older === true,
  };
}

/** What a replay noticed without stopping, as one line. */
export function noteText(n: { guesses: number; skipped: number; drift: number | null }): string {
  const t = T();
  return [n.guesses > 0 ? t.guessed(n.guesses) : "", n.skipped > 0 ? t.skippedChanges(n.skipped) : "", n.drift !== null ? t.drifted(n.drift) : ""].filter(Boolean).join(" ");
}

/** A change by hand as its line in the text: a record entry added or taken out, a resource moved or set. */
export function manualLine(a: PlacedAside, names: { records: { id: string; name: string }[]; resources: { id: string; name: string }[] }): string {
  if (a.kind === "record") {
    const name = names.records.find((x) => x.id === a.var)?.name ?? a.var ?? "";
    return `📝 ${name} ${a.op === "remove" ? "−" : "+"} ${a.entry ?? ""}`;
  }
  const r = a.result as { from: unknown; to: unknown } | null;
  const name = names.resources.find((x) => x.id === a.var)?.name ?? a.var ?? "";
  const change = a.kind === "adjust" ? `${(a.delta ?? 0) > 0 ? "+" : ""}${a.delta ?? 0}` : `= ${String(a.value)}`;
  return `✎ ${name} ${change}${r ? `(${String(r.from)} → ${String(r.to)})` : ""}`;
}

/** The oracle's answer, worded (yes, no, and the extreme ones). */
export function oracleAnswer(r: OracleResult): string {
  return T().answers[r.answer === "yes" ? (r.extreme ? "yesAnd" : "yes") : r.extreme ? "noAnd" : "no"];
}

/** What a `#play` choice waits for: a card, several, an item; or that there is nothing to play. */
export function pickHint(play: ChoicePlay): string {
  const t = T();
  if (!(play.known && play.cards.length >= play.min)) return `${play.use ? t.inventory : play.name} · ${t.nothingCarried}`;
  if (play.use) return t.pickItem;
  if (play.max <= 1) return t.pickCard;
  return (play.min === play.max ? t.pickCardsN : t.pickCardsRange).split("{min}").join(String(play.min)).split("{max}").join(String(play.max));
}
