import type { RollRecord } from "../game/engine";
import { tokenText } from "../game/dice";
import { stringsFor, type Language } from "../i18n";
import type { Paragraph, PlacedAside } from "./session";
import type { OracleResult, TrayRoll } from "./oracle";

/**
 * A play session as a markdown note: the text read, each choice made where it was made, and
 * every roll as a line where the panel shows its card. Pure: the plugin decides the path and
 * writes the file.
 */
export interface JournalInput {
  title: string;
  date: Date;
  /** Language of the labels (the band names, "Character"). */
  language: Language;
  character?: string | null;
  log: readonly Paragraph[];
  /** The story's turn per paragraph, aligned with `log` (null for text restored from a save). */
  turns: readonly (number | null)[];
  /** The choices made, oldest first: text and the index in `log` where the text they produced begins. */
  choices: readonly { text: string; at: number }[];
  rolls: readonly RollRecord[];
  /** Speaking skill per paragraph, aligned with `log`. */
  voices?: readonly (string | null)[];
  skills?: readonly { id: string; name: string }[];
  /** The dice tray's questions and rolls, where they were asked (oldest first). */
  asides?: readonly PlacedAside[];
}

/** One question or roll from the dice tray as a line: `🔮 门后有人吗(很可能)d100 34 / 75 → 是`, `🎲 动作 1d6: 4 = 4 · 寻找`. */
export function asideLine(a: PlacedAside, language: Language): string {
  const s = stringsFor(language);
  if (a.kind === "oracle") {
    const r = a.result as OracleResult;
    const answer = s.answers[r.answer === "yes" ? (r.extreme ? "yesAnd" : "yes") : r.extreme ? "noAnd" : "no"];
    return `🔮 ${s.oracleLine(a.question ?? "", s.oddsNames[a.odds ?? "even"] ?? a.odds ?? "", r.roll, r.threshold, answer)}`;
  }
  const r = a.result as TrayRoll;
  const out = new Set(r.dropped ?? []);
  const faces = r.rolls.map((f, i) => (out.has(i) ? `~~${f}~~` : String(f))).join("+") || "—";
  return `🎲 ${r.table ? `${r.table.name} ` : ""}${r.formula}: ${faces} = ${r.total}${r.table ? ` · ${r.table.text}` : ""}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-01 21:05`, local time. */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One roll as a line: `🎲 力量 10:3+4 +5 = 12 · 成功`, or `🎲 遭遇 1d6:4 = 4 · 狼`. */
export function rollLine(r: RollRecord, language: Language, skills: readonly { id: string; name: string }[] = []): string {
  const s = stringsFor(language);
  // Faces that do not count (not kept, or missed in a pool) are struck out.
  const out = new Set(r.kind === "dice" ? r.dropped ?? [] : []);
  const faces = r.rolls.length > 0 ? r.rolls.map((f, i) => (out.has(i) ? `~~${f}~~` : String(f))).join("+") : "—";
  if (r.kind === "dice") {
    if (r.unknown) return `🎲 ${r.formula} ${s.badFormula}`;
    const head = r.deck ? r.deck.name : r.table ? `${r.table.name} ${r.formula}` : r.formula;
    const result = r.deck ? r.deck.card : r.table?.text;
    return `🎲 ${head}: ${faces} = ${r.total}${result !== undefined ? ` · ${result}` : ""}`;
  }
  const name = r.unknown ? `${r.skill} ${s.unknownSkill}` : skills.find((k) => k.id === r.skill)?.name ?? r.skill;
  const mods = r.modifiers.map((m) => ` ${m.value > 0 ? "+" : ""}${m.value}`).join("");
  const drawn = r.token ? tokenText(r.token, { fail: s.autoFail, success: s.autoSuccess }) : faces;
  return `🎲 ${name} ${r.difficulty}: ${drawn} +${r.level}${mods} = ${r.total} · ${s.bands[r.band]}`;
}

export function renderJournal(j: JournalInput): string {
  const s = stringsFor(j.language);
  const out: string[] = [`# ${j.title}`, ""];
  out.push([formatDate(j.date), ...(j.character ? [`${s.character}: ${j.character}`] : [])].join(" · "), "");
  const byTurn = new Map<number, RollRecord[]>();
  for (const r of j.rolls) byTurn.set(r.turn, [...(byTurn.get(r.turn) ?? []), r]);
  let lastTurn: number | null = null;
  let next = 0;
  const asides = j.asides ?? [];
  let nextAside = 0;
  // Choices and tray lines up to paragraph i, in the order they were done: an aside before the choice made after it.
  const choicesBefore = (i: number) => {
    for (;;) {
      const a = asides[nextAside], c = j.choices[next];
      const aReady = a !== undefined && a.at <= i, cReady = c !== undefined && c.at <= i;
      if (aReady && (!cReady || a.after <= next)) {
        out.push(`> ${asideLine(a, j.language)}`, "");
        nextAside++;
      } else if (cReady) {
        out.push(`**→ ${c.text}**`, "");
        next++;
      } else break;
    }
  };
  j.log.forEach((p, i) => {
    choicesBefore(i);
    const turn = j.turns[i] ?? null;
    if (turn !== null && (i === 0 || turn !== lastTurn)) for (const r of byTurn.get(turn) ?? []) out.push(`> ${rollLine(r, j.language, j.skills)}`, "");
    lastTurn = turn;
    const voice = j.voices?.[i] ?? null;
    const skill = voice === null ? undefined : j.skills?.find((k) => k.id === voice);
    out.push(skill ? `*${skill.name}:${p.text}*` : p.text, "");
  });
  choicesBefore(Number.MAX_SAFE_INTEGER);
  return out.join("\n").trimEnd() + "\n";
}
