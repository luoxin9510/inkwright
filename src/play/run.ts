import type { Paragraph, Payload, ReplayAction, SaveData, Taken } from "./session";

/**
 * A run (one playthrough) as it is saved: not the story's state but everything the player did since the
 * start, replayed on the current story to resume it (see docs/solo-prd.md §4.0). Each device writes its
 * own copy of a run; `rev` / `baseRev` let the copies be merged (mergeRuns).
 */
export interface Run {
  schema: 1;
  /** "draft" for the author's working run of a story; a random id for a saved one. */
  id: string;
  /** Main story path. */
  story: string;
  name: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  /** The device that wrote this copy. */
  device: string;
  /** Revision of this copy: one more than the newest copy it was written over. */
  rev: number;
  /** The revision this copy was based on: copies at or below it were seen when it was written. */
  baseRev: number;
  startPoint: string | null;
  character: string | null;
  seeds: { story: number; dice: number; oracle: number };
  /** The seq the next action gets: seqs are never reused in a run. */
  seqNext: number;
  actions: Action[];
  /** Actions a replay could not take (the story changed); kept until the player does something new there. Never written. */
  pending?: Action[];
  journal?: { path: string; writtenSeq: number };
  /** Hash of the version of the story (compiled story and game config) the run was last played on; kept as a build. */
  build?: string;
  /** Set on a run kept because two devices went different ways at once: the id of the run it forked from. */
  conflictOf?: string;
  /** An old save (before runs): its actions start from this state instead of the story's start. */
  legacy?: { from: "start"; state: string } | { from: "save"; state: string; log: Paragraph[] };
}

/** One thing the player did. Only `choose` exists so far; the other kinds are reserved for the slices that add them. */
export type Action = { seq: number; lang: string | null } & (
  | { kind: "choose"; index: number; text: string | null; payload?: Payload; fp: string; offered?: string[] }
  | { kind: "oracle"; question?: string; odds: string; result: unknown }
  | { kind: "roll"; formula: string; table?: string; result: unknown }
  | { kind: "adjust"; var: string; delta: number }
  | { kind: "set"; var: string; value: number | string }
  | { kind: "record"; record: string; op: "add" | "remove"; entry: string }
);

/** An old save as the plugin kept it in its data. */
export interface OldSave extends SaveData {
  id: string;
  name: string;
  savedAt: string;
}

export interface NewRunOptions {
  story: string;
  name: string;
  draft: boolean;
  startPoint: string | null;
  character: string | null;
  device: string;
  now: string;
  random?: () => number;
}

const MAX_SEED = 0x7fffffff;

export function newRun(o: NewRunOptions): Run {
  const random = o.random ?? Math.random;
  const seed = () => 1 + Math.floor(random() * (MAX_SEED - 1));
  return {
    schema: 1,
    id: o.draft ? "draft" : `${Date.now().toString(36)}${Math.floor(random() * 1e8).toString(36)}`,
    story: o.story,
    name: o.name,
    draft: o.draft,
    createdAt: o.now,
    updatedAt: o.now,
    device: o.device,
    rev: 0,
    baseRev: 0,
    startPoint: o.startPoint,
    character: o.character,
    // ink's own RANDOM adds its storySeed to the last random number; a small seed like ink's own keeps the sum in range.
    seeds: { story: Math.floor(random() * 100), dice: seed(), oracle: seed() },
    seqNext: 0,
    actions: [],
  };
}

/** The run with the session's record as its actions (pending dropped: the player has moved on). */
export function withTaken(run: Run, taken: readonly Taken[], seqNext: number, now: string): Run {
  const actions: Action[] = taken.map((t) => ({
    kind: "choose", seq: t.seq, lang: t.lang, index: t.index, text: t.text, ...(t.payload ? { payload: t.payload } : {}), fp: t.fp, offered: t.offered,
  }));
  const { pending: _pending, ...rest } = run;
  return { ...rest, actions, seqNext: Math.max(seqNext, run.seqNext), updatedAt: now };
}

/** The run's choices to replay, up to the first action of a kind this version cannot replay. */
export function replayActions(run: Run): ReplayAction[] {
  const out: ReplayAction[] = [];
  for (const a of run.actions) {
    if (a.kind !== "choose") break;
    out.push({ index: a.index, text: a.text, lang: a.lang, seq: a.seq, ...(a.payload ? { payload: a.payload } : {}), ...(a.fp ? { fp: a.fp } : {}), ...(a.offered ? { offered: a.offered } : {}) });
  }
  return out;
}

/** The folder a story's runs live in: its name (or its folder's, for `main.ink`) and a hash of its path. */
export function storyFolder(path: string): string {
  const parts = path.split("/");
  const file = (parts.at(-1) ?? path).replace(/\.ink$/, "");
  const name = file === "main" && parts.length > 1 ? parts[parts.length - 2] : file;
  return `${name.replace(/[\\/:*?"<>|#^[\]]/g, "_")}-${hash(path)}`;
}

/** FNV-1a as 8 hex digits. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface Merged {
  run: Run;
  /** Copies that went their own way at the same time as the winner: kept as runs of their own. */
  conflicts: Run[];
  /** Copies the winner already includes: safe to remove. */
  superseded: Run[];
}

/**
 * Merges the copies of one run the devices wrote. The newest revision wins (a back on one device beats
 * the longer run it was written over); a copy written at the same time is fine when it is a prefix of the
 * winner, else it is a conflict, kept as a run of its own rather than lost.
 */
export function mergeRuns(copies: readonly Run[]): Merged {
  const sorted = [...copies].sort((a, b) => b.rev - a.rev || b.updatedAt.localeCompare(a.updatedAt) || b.device.localeCompare(a.device));
  const [run, ...rest] = sorted;
  const conflicts: Run[] = [];
  const superseded: Run[] = [];
  for (const c of rest) {
    if (c.rev <= run.baseRev || isPrefix(c.actions, run.actions)) superseded.push(c);
    else if (!conflicts.some((k) => sameActions(k.actions, c.actions))) conflicts.push(c);
  }
  return { run, conflicts, superseded };
}

function isPrefix(a: readonly Action[], b: readonly Action[]): boolean {
  return a.length <= b.length && a.every((x, i) => sameAction(x, b[i]));
}

function sameActions(a: readonly Action[], b: readonly Action[]): boolean {
  return a.length === b.length && isPrefix(a, b);
}

function sameAction(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** An old save as a run: one with replay data starts from its start state and checks its choices by index only. */
export function migrateSave(save: OldSave, story: string, device: string): Run {
  const run: Run = {
    ...newRun({ story, name: save.name, draft: false, startPoint: save.startPoint, character: null, device, now: save.savedAt }),
    id: `legacy-${save.id}`,
  };
  if (save.start !== undefined && save.picks !== undefined) {
    const actions: Action[] = save.picks.map((p, i) =>
      typeof p === "number"
        ? { kind: "choose", seq: i, lang: null, index: p, text: null, fp: "" }
        : { kind: "choose", seq: i, lang: null, index: p.index, text: null, payload: p.payload, fp: "" });
    return { ...run, legacy: { from: "start", state: save.start }, actions, seqNext: actions.length };
  }
  return { ...run, legacy: { from: "save", state: save.state, log: save.log } };
}
