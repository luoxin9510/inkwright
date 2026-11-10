import { T } from "../i18n";
import type { Fx } from "../game/config";
import type { RollRecord } from "../game/engine";
import type { OracleResult, TrayRoll } from "../play/oracle";
import type { PlacedAside } from "../play/session";
import { checkLabel, checkSum, diceLabel, diceResult, manualLine, oracleAnswer, tokenOf } from "../play/describe";
import type { GameView } from "./PlayView";

/** The cards drawn in the story's text: a roll where its check happened, a question or roll from the dice tray, a change by hand. */

/** One roll as a card: a check (skill and difficulty, faces, sum, outcome) or free dice (formula or table, faces, total, the row). */
export function renderRoll(parent: HTMLElement, r: RollRecord, game: GameView): HTMLElement {
  if (r.kind === "dice") {
    const card = parent.createDiv({ cls: "inkwright-roll inkwright-roll-free" });
    card.createSpan({ cls: "inkwright-roll-skill", text: diceLabel(r) });
    faces(card, r.rolls, r.dropped);
    card.createSpan({ cls: "inkwright-roll-sum", text: r.unknown ? T().badFormula : `= ${r.total}` });
    const result = diceResult(r);
    if (result !== undefined) card.createSpan({ cls: "inkwright-roll-band", text: result, ...(r.deck?.desc ? { title: r.deck.desc } : {}) });
    return card;
  }
  const card = parent.createDiv({ cls: `inkwright-roll inkwright-roll-${r.band}` });
  card.createSpan({ cls: "inkwright-roll-skill", text: checkLabel(r, game.skills) });
  // A chaos bag draws a token instead of rolling: shown as one chip, named or by its value.
  const token = tokenOf(r);
  const chip = r.token && token !== null ? { cls: `inkwright-die inkwright-chip${r.token.auto ? ` inkwright-chip-${r.token.auto}` : ""}`, text: token } : undefined;
  faces(card, r.rolls, undefined, chip);
  card.createSpan({ cls: "inkwright-roll-sum", text: checkSum(r) });
  card.createSpan({ cls: "inkwright-roll-band", text: T().bands[r.band] });
  return card;
}

/** One question or roll from the dice tray, or a change by hand, as it shows in the text. */
export function renderAside(parent: HTMLElement, a: PlacedAside, game: GameView | null): HTMLElement {
  if (a.kind === "record" || a.kind === "adjust" || a.kind === "set") {
    return parent.createDiv({ cls: "inkwright-manual", text: manualLine(a, { records: game?.hud.records ?? [], resources: game?.hud.resources ?? [] }) });
  }
  const t = T();
  if (a.kind === "oracle") {
    const r = a.result as OracleResult;
    const card = parent.createDiv({ cls: `inkwright-roll inkwright-oracle inkwright-oracle-${r.answer}` });
    card.createSpan({ cls: "inkwright-roll-skill", text: `🔮 ${a.question ?? ""}` });
    card.createSpan({ cls: "inkwright-oracle-odds", text: `${t.oddsNames[a.odds ?? "even"] ?? ""} · d100 ${r.roll} / ${r.threshold}` });
    card.createSpan({ cls: "inkwright-roll-band", text: oracleAnswer(r) });
    return card;
  }
  const r = a.result as TrayRoll;
  const card = parent.createDiv({ cls: "inkwright-roll inkwright-roll-free inkwright-tray-roll" });
  card.createSpan({ cls: "inkwright-roll-skill", text: r.table ? `${r.table.name} ${r.formula}` : r.formula });
  faces(card, r.rolls, r.dropped);
  card.createSpan({ cls: "inkwright-roll-sum", text: `= ${r.total}` });
  if (r.table) card.createSpan({ cls: "inkwright-roll-band", text: r.table.text });
  return card;
}

/** The dice faces (after a bag's token chip, if any); those that do not count (not kept, or missed in a pool) faded. */
function faces(card: HTMLElement, rolls: number[], dropped?: number[], chip?: { cls: string; text: string }): HTMLElement {
  const dice = card.createSpan({ cls: "inkwright-roll-dice" });
  if (chip) dice.createSpan(chip);
  const out = new Set(dropped ?? []);
  rolls.forEach((face, i) => dice.createSpan({ cls: `inkwright-die${out.has(i) ? " inkwright-die-dropped" : ""}`, text: String(face) }));
  return dice;
}

/** Whether motion is turned down (the system setting): rolls do not tumble, effects do not play. */
function stillMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The faces of new cards tumble for a moment before settling; returns the timers (for the view to clear on close). */
export function animateRolls(cards: HTMLElement[]): number[] {
  if (cards.length === 0 || stillMotion()) return [];
  return cards.map((card) => {
    const dice = Array.from(card.querySelectorAll<HTMLElement>(".inkwright-die"));
    const shown = dice.map((d) => d.textContent ?? "");
    card.addClass("inkwright-rolling");
    let ticks = 0;
    const timer = window.setInterval(() => {
      if (++ticks > 8) {
        window.clearInterval(timer);
        dice.forEach((d, i) => d.setText(shown[i]));
        card.removeClass("inkwright-rolling");
        return;
      }
      // A bag's chip does not show dice faces while it "tumbles": a question mark instead.
      for (const d of dice) d.setText(d.hasClass("inkwright-chip") ? "?" : String(1 + Math.floor(Math.random() * 6)));
    }, 70);
    return timer;
  });
}

/** Plays the effects of the new lines on the story, one after another. */
export function playFx(target: HTMLElement, effects: Fx[]): void {
  if (effects.length === 0 || stillMotion()) return;
  effects.forEach((fx, i) => {
    const play = () => {
      const cls = `inkwright-fx-${fx}`;
      const done = () => target.removeClass(cls);
      target.addClass(cls);
      target.addEventListener("animationend", done, { once: true });
      window.setTimeout(done, 2500);
    };
    if (i === 0) play();
    else window.setTimeout(play, i * 900);
  });
}
