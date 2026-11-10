import type { RollRecord } from "../game/engine";
import { tokenText } from "../game/dice";
import { stringsFor, type Language } from "../i18n";
import type { Paragraph, Payload, PlacedAside } from "./session";
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

/**
 * The asides as they are shown: a run of hand changes to the same variable at the same place (ticking a track
 * five times) reads as one change, from the first value to the last. Each stays its own action in the run.
 */
export function mergeAsides(asides: readonly PlacedAside[]): PlacedAside[] {
  const out: PlacedAside[] = [];
  for (const a of asides) {
    const last = out.at(-1);
    if (last && a.kind === "adjust" && last.kind === "adjust" && last.var === a.var && last.at === a.at && last.after === a.after) {
      const from = (last.result as { from: unknown } | null)?.from, to = (a.result as { to: unknown } | null)?.to;
      out[out.length - 1] = { ...last, delta: (last.delta ?? 0) + (a.delta ?? 0), result: { from, to }, seq: a.seq };
    } else out.push(a);
  }
  return out;
}

/** One question or roll from the dice tray as a line: `🔮 门后有人吗(很可能)d100 34 / 75 → 是`, `🎲 动作 1d6: 4 = 4 · 寻找`. */
export function asideLine(a: PlacedAside, language: Language): string {
  const s = stringsFor(language);
  if (a.kind === "record") return `📝 ${a.var ?? ""} ${a.op === "remove" ? "−" : "+"} ${a.entry ?? ""}`;
  if (a.kind === "adjust" || a.kind === "set") {
    const r = a.result as { from: unknown; to: unknown } | null;
    const change = a.kind === "adjust" ? `${(a.delta ?? 0) > 0 ? "+" : ""}${a.delta ?? 0}` : `= ${String(a.value)}`;
    return `✎ ${a.var ?? ""} ${change}${r ? ` (${String(r.from)} → ${String(r.to)})` : ""}`;
  }
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
    const head = r.deck ? r.deck.name : r.record ? r.record.name : r.table ? `${r.table.name} ${r.formula}` : r.formula;
    const result = r.deck ? r.deck.card : r.record ? r.record.entry : r.table?.text;
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
  const asides = mergeAsides(j.asides ?? []);
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


/** What the live journal reads: the session's text, choices (with where their text begins) and asides, and how far it was written. */
export interface LiveInput {
  language: Language;
  log: readonly Paragraph[];
  turns: readonly (number | null)[];
  rolls: readonly RollRecord[];
  voices?: readonly (string | null)[];
  skills?: readonly { id: string; name: string }[];
  /** The choices made, oldest first: seq, text, the index in `log` where their text begins, what they carried, whether it was a paragraph (#write). */
  taken: readonly { seq: number; text: string; at: number; payload?: Payload; write?: boolean }[];
  asides: readonly PlacedAside[];
  /** The highest seq written so far (-1: nothing). */
  writtenSeq: number;
  /** The latest seq in the run when it was last written (-1: nothing): gone now means the player went back. */
  writtenTop: number;
}

/** The player's own text, quoted line by line so nothing in it (a heading, a rule) can change the note. */
const quote = (text: string) => text.split("\n").map((l) => `> ${l}`).join("\n");

/** The paragraphs log[from, to) with the roll lines where their turns begin, as journal lines. */
function paragraphs(j: LiveInput, from: number, to: number): string[] {
  const byTurn = new Map<number, RollRecord[]>();
  for (const r of j.rolls) byTurn.set(r.turn, [...(byTurn.get(r.turn) ?? []), r]);
  const out: string[] = [];
  for (let i = from; i < to && i < j.log.length; i++) {
    const turn = j.turns[i] ?? null;
    if (turn !== null && (i === 0 || turn !== (j.turns[i - 1] ?? null))) for (const r of byTurn.get(turn) ?? []) out.push(`> ${rollLine(r, j.language, j.skills)}`);
    const voice = j.voices?.[i] ?? null;
    const skill = voice === null ? undefined : j.skills?.find((k) => k.id === voice);
    out.push(skill ? `*${skill.name}:${j.log[i].text}*` : j.log[i].text);
  }
  return out;
}

/** The top of a live journal: the title, the date (and character), and the text before the first choice. */
export function liveHeader(meta: { title: string; date: Date; language: Language; character?: string | null }, j: LiveInput): string {
  const s = stringsFor(meta.language);
  const head = [`# ${meta.title}`, [formatDate(meta.date), ...(meta.character ? [`${s.character}: ${meta.character}`] : [])].join(" · ")];
  const intro = paragraphs(j, 0, j.taken[0]?.at ?? j.log.length);
  return [...head, ...intro].join("\n\n") + "\n";
}

/**
 * What to append to a live journal now: each action done since it was last written (by seq), a choice with the
 * text it brought (and a paragraph written with it, quoted), an aside as a line; and, when the action last
 * written is gone (the player went back), a line saying so first. Nothing written before is ever taken out.
 */
export function liveBlocks(j: LiveInput): { text: string; writtenSeq: number; writtenTop: number } {
  const s = stringsFor(j.language);
  const present = new Set([...j.taken.map((t) => t.seq), ...j.asides.map((a) => a.seq)]);
  const top = Math.max(-1, ...present);
  const blocks: string[] = [];
  // Went back: to the step after the choices written before that are still there.
  if (j.writtenTop >= 0 && !present.has(j.writtenTop)) blocks.push(`↩ ${s.wentBack(j.taken.filter((t) => t.seq <= j.writtenSeq).length + 1)}`);
  type Item = { seq: number; render: () => string[] };
  const items: Item[] = [];
  j.taken.forEach((t, k) => {
    if (t.seq <= j.writtenSeq) return;
    items.push({
      seq: t.seq,
      render: () => {
        const typed = t.payload && "text" in t.payload ? t.payload.text : "";
        const written = t.write && typed ? [quote(typed)] : [];
        const head = typed && !t.write ? `${t.text} · ${typed}` : t.text;
        return [`**→ ${head}**`, ...written, ...paragraphs(j, t.at, j.taken[k + 1]?.at ?? j.log.length)];
      },
    });
  });
  for (const a of mergeAsides(j.asides)) if (a.seq > j.writtenSeq) items.push({ seq: a.seq, render: () => [`> ${asideLine(a, j.language)}`] });
  items.sort((x, y) => x.seq - y.seq);
  for (const it of items) blocks.push(...it.render());
  const writtenSeq = Math.max(j.writtenSeq, ...items.map((i) => i.seq));
  return { text: blocks.map((b) => `\n${b}\n`).join(""), writtenSeq, writtenTop: top };
}

/**
 * A journal note's path from a template (`{dir}`, `{story}`, `{date}`, `{time}`, `{character}`): names go in cleaned
 * (no separators, nothing a file system rejects, no ".."), "." and ".." segments are dropped so it stays inside the
 * vault, and ".md" is added. `unknown` lists placeholders the template has that are not among these.
 */
export function journalPath(template: string, at: { dir: string; story: string; character: string | null; now: Date }): { path: string; unknown: string[] } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const clean = (v: string) => Array.from(v).filter((c) => c.charCodeAt(0) >= 32).join("").replace(/[\\/:*?"<>|]/g, "-").replace(/\.{2,}/g, "-").trim();
  const { now } = at;
  const values: Record<string, string> = {
    dir: at.dir, story: clean(at.story), character: clean(at.character ?? ""),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}-${pad(now.getMinutes())}`,
  };
  const unknown: string[] = [];
  const filled = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    unknown.push(key);
    return "";
  });
  let path = filled.split(/[\\/]/).map((seg) => seg.trim()).filter((seg) => seg !== "" && seg !== "." && seg !== "..").join("/");
  if (!path.endsWith(".md")) path += ".md";
  return { path, unknown };
}
