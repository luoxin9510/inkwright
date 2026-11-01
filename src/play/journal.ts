import type { RollRecord } from "../game/engine";
import { stringsFor, type Language } from "../i18n";
import type { Paragraph } from "./session";

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
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-01 21:05`, local time. */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One roll as a line: `🎲 力量 10:3+4 +5 = 12 · 成功`, or `🎲 遭遇 1d6:4 = 4 · 狼`. */
export function rollLine(r: RollRecord, language: Language, skills: readonly { id: string; name: string }[] = []): string {
  const s = stringsFor(language);
  const faces = r.rolls.length > 0 ? r.rolls.join("+") : "—";
  if (r.kind === "dice") {
    if (r.unknown) return `🎲 ${r.formula} ${s.badFormula}`;
    const head = r.table ? `${r.table.name} ${r.formula}` : r.formula;
    return `🎲 ${head}: ${faces} = ${r.total}${r.table ? ` · ${r.table.text}` : ""}`;
  }
  const name = r.unknown ? `${r.skill} ${s.unknownSkill}` : skills.find((k) => k.id === r.skill)?.name ?? r.skill;
  const mods = r.modifiers.map((m) => ` ${m.value > 0 ? "+" : ""}${m.value}`).join("");
  return `🎲 ${name} ${r.difficulty}: ${faces} +${r.level}${mods} = ${r.total} · ${s.bands[r.band]}`;
}

export function renderJournal(j: JournalInput): string {
  const s = stringsFor(j.language);
  const out: string[] = [`# ${j.title}`, ""];
  out.push([formatDate(j.date), ...(j.character ? [`${s.character}: ${j.character}`] : [])].join(" · "), "");
  const byTurn = new Map<number, RollRecord[]>();
  for (const r of j.rolls) byTurn.set(r.turn, [...(byTurn.get(r.turn) ?? []), r]);
  let lastTurn: number | null = null;
  let next = 0;
  const choicesBefore = (i: number) => {
    while (next < j.choices.length && j.choices[next].at <= i) out.push(`**→ ${j.choices[next++].text}**`, "");
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
