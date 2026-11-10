import { InkList, Story } from "inkjs/full";
import { translateRuntime } from "../compile/diagnostics";
import { T } from "../i18n";
import { inspect, type Inspection } from "./inspect";
import { findChoice, type ReplayMode } from "./match";
import { speedUpInkjs } from "./inkjs-speed";
import { isWrite } from "./input";
import { recordAdd, recordDrop, recordEntries } from "../game/records";

export interface Paragraph {
  text: string;
  tags: string[];
}

export interface Choice {
  index: number;
  text: string;
  /** Tags written inside the choice's brackets, e.g. `check:力量:12`. */
  tags: string[];
}

/**
 * What a choice carries besides its index: a variable written just before the choice is taken.
 * A card played from a hand (`item`: an ink list item by name) or text the player typed.
 */
export type Payload = { var: string; item: string } | { var: string; items: string[] } | { var: string; text: string };

/** A choice made, as replayed in another language: the index alone, or with its payload. */
export type Pick = number | { index: number; payload: Payload };

/** One choice made in a run: its text, where the text it produced begins in the log, and what it carried. */
export interface Chosen {
  text: string;
  at: number;
  payload?: Payload;
}

export interface Step {
  paragraphs: Paragraph[];
  choices: Choice[];
  ended: boolean;
  errors: string[];
}

/**
 * A choice made in this run, as the run's record keeps it: what was chosen (index and the choice's
 * text in the language it was shown in), what it carried, its seq (unique in the run, never reused
 * after back) and a fingerprint of what it led to (the rolls it made and how many choices came next).
 */
export interface Taken {
  index: number;
  text: string;
  lang: string | null;
  payload?: Payload;
  seq: number;
  fp: string;
  /** The texts of every choice offered with it, in order: lets a replay see that only this one was reworded. */
  offered: string[];
  /** It asked for a paragraph (`#write`): the journal quotes what was written. */
  write?: boolean;
}

/**
 * Something the player did beside the story (the dice tray): an oracle question or a roll, with what came
 * out. It changes no story variable; it is kept where it happened, with a seq like a choice.
 */
export interface Aside {
  seq?: number;
  lang: string | null;
  /** "adjust" / "set": the player changed a variable by hand (the only asides that change the story). */
  kind: "oracle" | "roll" | "adjust" | "set" | "record";
  question?: string;
  odds?: string;
  formula?: string;
  table?: string;
  /** adjust / set: the variable, what was added, or the value set. record: the record's store variable. */
  var?: string;
  delta?: number;
  value?: number | string;
  /** record: its counter variable, whether an entry is added or taken out, and the entry. */
  count?: string;
  op?: "add" | "remove";
  entry?: string;
  result: unknown;
}

/** An aside where it happened: after `at` paragraphs of the log and `after` choices. */
export interface PlacedAside extends Aside {
  seq: number;
  at: number;
  after: number;
  /** adjust / set: the story's state just before, so undo can put it back. */
  before?: string;
}

/** A recorded choice to replay; `text` null for one recorded without it (an old save): checked by index only. */
export interface ReplayAction {
  index: number;
  text: string | null;
  lang: string | null;
  payload?: Payload;
  seq: number;
  /** The fingerprint recorded with it: a different one on replay is reported as drift. */
  fp?: string;
  /** The texts offered with it (see Taken.offered). */
  offered?: string[];
  /** Not a choice: an aside to put back where it was, as recorded (index and text unused). */
  aside?: Aside;
}

/**
 * How a replay finds each recorded choice: "strict" only at its index with its text; "match" also by its
 * text being unique on the screen, or (a guess) by its text with the numbers left out being unique, or by it
 * being the one choice reworded on a screen that otherwise did not change; "index" whatever is at its index.
 */
export type { ReplayMode } from "./match";

export interface ReplayOptions {
  mode?: ReplayMode;
  /** Stops the replay (`aborted` in the result); the session is left wherever it got to. */
  signal?: AbortSignal;
  /** Wall-clock time the whole replay may take; past it the replay stops with reason "budget". */
  budgetMs?: number;
  /** Time to work before yielding to the event loop (default 16 ms). */
  sliceMs?: number;
  /** How to yield: the panel waits for a timer so it can draw (`window.setTimeout`); default a microtask. */
  wait?: () => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

export interface ReplayResult {
  step: Step;
  /** Actions replayed. */
  done: number;
  /** Where and why the replay stopped before the end; null when every action was replayed (or it was aborted). */
  stop: { at: number; reason: "mismatch" | "error" | "budget" } | null;
  aborted: boolean;
  /** Actions (by position) found only by a guess (numbers changed, or reworded). */
  guesses: number[];
  /** Hand changes (by position) to a variable the story no longer has: skipped. */
  skipped: number[];
  /** The first action (by position) whose outcome differs from its recorded fingerprint; null when none did. */
  drift: number | null;
}

/** Everything needed to resume a session later; plain JSON. */
export interface SaveData {
  /** inkjs story state (story.state.ToJson()). */
  state: string;
  /** Text shown so far, so the panel can be restored as it was. */
  log: Paragraph[];
  startPoint: string | null;
  /** State at the start point plus every choice since, so the run can be replayed in another language. */
  start?: string;
  picks?: Pick[];
}

/** Global variables a story can declare to be played in several languages ("zh" / "en"). */
export const LANGUAGE_VARS = ["语言", "lang"];
/** Languages a bilingual story can be played in, with their names in that language. */
export const STORY_LANGUAGES = [{ code: "zh", name: "中文" }, { code: "en", name: "English" }];

export interface SessionOptions {
  /** Max wall-clock time one step may run before it is treated as an infinite loop. */
  timeBudgetMs?: number;
  /** Language to play a bilingual story in (see LANGUAGE_VARS); default: the story's own value. */
  language?: string;
  /**
   * Runs on every Story the session builds (start, restart, back, load, language replay), before
   * it continues: bind EXTERNAL functions, load presets. A game engine hooks in here.
   */
  setup?: (story: Story) => void;
  /**
   * Runs on a fresh start only (start, restart, startAt), after `setup` and before the language and the
   * start point: where a saved run writes back its seeds (ink's storySeed, the engine's dice seed).
   */
  prepare?: (story: Story) => void;
  /** The rolls of the current run so far, one short signature each; the new ones after a choice go into its fingerprint. */
  outcome?: () => readonly string[];
  /** Keeps a value changed by hand within its variable's range (a resource's min..max). */
  clampVar?: (name: string, value: number) => number;
}

const SLICE_MS = 20;

/** The story's language variable (one of LANGUAGE_VARS), or null when it is not bilingual. */
export function findLanguageVar(story: Story): string | null {
  const globals = (story.variablesState as unknown as { _globalVariables?: Map<string, unknown> })._globalVariables;
  return LANGUAGE_VARS.find((name) => globals instanceof Map && globals.has(name)) ?? null;
}

export class PlaySession {
  private story: Story;
  private readonly json: string;
  /** The story JSON parsed, for new Stories (inkjs does not change it). */
  private readonly parsed: Record<string, unknown>;
  private readonly budget: number;
  private errors: string[] = [];
  private halted = false;
  /** Knot/stitch path the story starts from; null means the beginning. */
  startPoint: string | null = null;
  /** Every paragraph shown since the start (or since the loaded save). */
  log: Paragraph[] = [];
  /** State before each choice, for back(). */
  private history: { state: string; logLength: number }[] = [];
  /** The story's turn each paragraph of `log` was shown in; null for text restored from a save. */
  private turnOf: (number | null)[] = [];
  /** The story's language variable, or null when it is not bilingual. */
  readonly languageVar: string | null;
  private preferredLanguage: string | null;
  private readonly setup?: (story: Story) => void;
  private readonly prepare?: (story: Story) => void;
  private readonly outcome?: () => readonly string[];
  private readonly clampVar?: (name: string, value: number) => number;
  /** The record of this run's choices (see Taken); empty after a load. */
  private takenList: Taken[] = [];
  /** The next seq to give a choice: seqs are never reused within a run, even after back. */
  private nextSeq = 0;
  /** The asides of this run (the dice tray), oldest first. */
  private asideList: PlacedAside[] = [];
  /** State at the start point; null after loading a save made without one. */
  private startState: string | null = null;
  /** Choices made since startState. */
  private picks: Pick[] = [];
  /** The choices made in this run: their text and where the text they produced begins in `log`. */
  private chosen: Chosen[] = [];

  constructor(story: Story, options: SessionOptions = {}) {
    this.json = story.ToJson() as string;
    // Parsed once: inkjs reads a JSON string with its own slow reader on every new Story (each restart, back, load).
    this.parsed = JSON.parse(this.json) as Record<string, unknown>;
    this.budget = options.timeBudgetMs ?? 2000;
    this.setup = options.setup;
    this.prepare = options.prepare;
    this.outcome = options.outcome;
    this.clampVar = options.clampVar;
    this.story = this.attach(story);
    this.languageVar = findLanguageVar(story);
    this.preferredLanguage = options.language ?? null;
    this.applyLanguage();
  }

  /** Current value of the language variable; null for a story that is not bilingual. */
  get language(): string | null {
    return this.languageVar === null ? null : String(this.story.variablesState[this.languageVar]);
  }

  /** Switches language and replays the run so far, so earlier text and current choices change too. */
  setLanguage(lang: string): Step {
    this.preferredLanguage = lang;
    if (this.languageVar === null) return this.snapshot([]);
    if (this.startState === null) {
      // No replay data (old save): only text from now on changes.
      this.applyLanguage();
      return this.snapshot([]);
    }
    const picks = this.picks;
    const seqs = this.takenList.map((t) => t.seq);
    const asides = this.asideList;
    this.story = this.attach(new Story(this.parsed));
    this.story.state.LoadJson(this.startState);
    this.applyLanguage();
    this.startState = this.story.state.ToJson();
    this.log = [];
    this.turnOf = [];
    this.history = [];
    this.picks = [];
    this.chosen = [];
    this.takenList = [];
    this.asideList = [];
    this.errors = [];
    this.halted = false;
    let step = this.advance();
    // Asides go back after as many choices as before, where the text in the new language has got to then.
    const place = (after: number) => {
      for (const a of asides) if (a.after === after) this.placeAside(a);
    };
    place(0);
    picks.forEach((pick, i) => {
      const seq = seqs[i];
      step = typeof pick === "number" ? this.choose(pick, undefined, seq) : this.choose(pick.index, pick.payload, seq);
      place(i + 1);
    });
    return { ...step, paragraphs: [] };
  }

  start(): Step {
    this.errors = [];
    this.log = [];
    this.turnOf = [];
    this.history = [];
    this.picks = [];
    this.chosen = [];
    this.takenList = [];
    this.asideList = [];
    // The constructor's Story is fresh: seeds go in before the language (already applied) matters to anything.
    this.prepare?.(this.story);
    this.applyLanguage();
    this.startState = this.story.state.ToJson();
    return this.advance();
  }

  /** The current screen (choices, ended, errors), with no new text. */
  current(): Step {
    return this.snapshot([]);
  }

  /** The record of this run's choices, oldest first. */
  get taken(): readonly Taken[] {
    return this.takenList;
  }

  /** The asides of this run, oldest first. */
  get asides(): readonly PlacedAside[] {
    return this.asideList;
  }

  /** Keeps an aside here: after the text so far and the choices so far. A replayed one keeps its seq. */
  addAside(a: Aside): PlacedAside {
    const seq = a.seq ?? this.nextSeq;
    this.nextSeq = Math.max(this.nextSeq, seq + 1);
    const placed: PlacedAside = { ...a, seq, at: this.log.length, after: this.takenList.length };
    this.asideList.push(placed);
    return placed;
  }

  /** Puts an aside here: a hand change is made again, anything else is kept as it was. */
  private placeAside(a: Aside): PlacedAside | null {
    return a.kind === "adjust" || a.kind === "set" || a.kind === "record" ? this.applyManual(a) : this.addAside(a);
  }

  /**
   * The player changes a variable by hand (adjust adds `delta`, set writes `value`), kept in range by `clampVar`;
   * recorded as an aside with what it came to and the state before it (for undo). Null when the story has no such
   * variable. The change shows from the next choice on: the choices on screen were worked out already.
   */
  applyManual(a: Aside): PlacedAside | null {
    const name = a.var;
    if (!name || this.halted || !this.story.variablesState.GlobalVariableExistsWithName(name)) return null;
    const raw: unknown = this.story.variablesState[name];
    // A record: the entry goes into (or out of) its store, and its counter follows.
    if (a.kind === "record") {
      const count = a.count;
      if (!count || !this.story.variablesState.GlobalVariableExistsWithName(count) || !a.entry) return null;
      const store = typeof raw === "string" ? raw : "";
      const next = a.op === "remove" ? recordDrop(store, a.entry) : recordAdd(store, a.entry);
      const before = this.story.state.ToJson();
      this.story.variablesState[name] = next;
      this.story.variablesState[count] = recordEntries(next).length;
      const placed = this.addAside({ ...a, result: { changed: next !== store } });
      placed.before = before;
      return placed;
    }
    const from = typeof raw === "number" ? raw : Number(raw);
    let to: number | string;
    if (a.kind === "adjust") to = (Number.isFinite(from) ? from : 0) + (a.delta ?? 0);
    else to = a.value ?? 0;
    if (typeof to === "number" && this.clampVar) to = this.clampVar(name, to);
    const before = this.story.state.ToJson();
    try {
      this.story.variablesState[name] = to;
    } catch {
      return null;
    }
    const placed = this.addAside({ ...a, result: { from: Number.isFinite(from) ? from : raw, to } });
    placed.before = before;
    return placed;
  }

  /** Takes back everything done from `seq` on (choices and asides alike), latest first. */
  undoUntil(seq: number): void {
    for (;;) {
      const latest = Math.max(this.takenList.at(-1)?.seq ?? -1, this.asideList.at(-1)?.seq ?? -1);
      if (latest < seq || this.undo() === null) return;
    }
  }

  /** Takes back the latest thing done: an aside, or a choice (see back). Null when there is nothing to take back. */
  undo(): Step | null {
    const aside = this.asideList.at(-1);
    const choice = this.takenList.at(-1);
    if (aside && (!choice || aside.seq > choice.seq)) {
      this.asideList.pop();
      // A hand change is undone by putting the state back as it was just before it.
      if (aside.before !== undefined) this.story.state.LoadJson(aside.before);
      return this.snapshot([]);
    }
    return this.back();
  }

  /** The seq the next choice will get. */
  get seqNext(): number {
    return this.nextSeq;
  }

  /** Continues seqs from a saved run, so a seq given before is not given again. */
  set seqNext(n: number) {
    this.nextSeq = Math.max(this.nextSeq, n);
  }

  /**
   * Replays recorded choices from where the session is (after start, startAt or a load), strictly: a choice
   * is taken only when the same index offers the same text (in the action's language; an action in another
   * language, or recorded without text, is checked by index only). Stops at the first that does not fit,
   * at a step that loops, or past the budget. Yields to the event loop every `sliceMs`, so the panel can draw
   * progress and a newer compile can abort it.
   */
  async replay(actions: readonly ReplayAction[], options: ReplayOptions = {}): Promise<ReplayResult> {
    const slice = options.sliceMs ?? 16;
    const budget = options.budgetMs ?? Infinity;
    const begun = Date.now();
    let worked = Date.now();
    let step = this.snapshot([]);
    const mode = options.mode ?? "strict";
    const guesses: number[] = [];
    const skipped: number[] = [];
    let drift: number | null = null;
    const result = (done: number, stop: ReplayResult["stop"], aborted = false): ReplayResult => ({ step, done, stop, aborted, guesses, skipped, drift });
    for (let i = 0; i < actions.length; i++) {
      if (options.signal?.aborted) return result(i, null, true);
      if (Date.now() - worked >= slice) {
        await (options.wait ?? (() => Promise.resolve()))();
        worked = Date.now();
        if (options.signal?.aborted) return result(i, null, true);
      }
      if (Date.now() - begun >= budget) return result(i, { at: i, reason: "budget" });
      const a = actions[i];
      // An aside is put back as it was recorded: nothing to find on the screen, nothing rolled again.
      if (a.aside) {
        // A hand change is made again (by its delta, on the value the story has now); one to a variable that is gone is skipped.
        if (this.placeAside({ ...a.aside, seq: a.seq }) === null) skipped.push(i);
        options.onProgress?.(i + 1, actions.length);
        continue;
      }
      const sameLanguage = a.lang === null || this.language === null || a.lang === this.language;
      const found = this.halted ? null : findChoice(this.story.currentChoices.map((c) => c.text), a, mode, sameLanguage);
      if (!found) return result(i, { at: i, reason: "mismatch" });
      if (found.guess) guesses.push(i);
      step = this.choose(found.index, a.payload, a.seq);
      // The choice was taken, but its step stopped (a loop): what comes after it cannot be replayed.
      if (this.halted) return result(i + 1, { at: i + 1, reason: "error" });
      if (drift === null && a.fp && this.takenList.at(-1)?.fp !== a.fp) drift = i;
      options.onProgress?.(i + 1, actions.length);
    }
    return result(actions.length, null);
  }

  /** Takes a choice; a payload writes its variable (a card as a list item, or text) just before. `seq` keeps a replayed choice's seq. */
  choose(index: number, payload?: Payload, seq?: number): Step {
    this.errors = [];
    if (this.halted) return this.snapshot([]);
    this.history.push({ state: this.story.state.ToJson(), logLength: this.log.length });
    const text = this.story.currentChoices[index]?.text ?? "";
    const offered = this.story.currentChoices.map((c) => c.text);
    const write = isWrite({ tags: this.story.currentChoices[index]?.tags ?? [] });
    const lang = this.language;
    const rolled = this.outcome?.().length ?? 0;
    try {
      if (payload) this.story.variablesState[payload.var] = payloadValue(payload, this.story);
      this.story.ChooseChoiceIndex(index);
    } catch (e) {
      // A payload that does not fit the story (no such list item) must not leave half a move behind.
      const prev = this.history.pop();
      if (prev) this.story.state.LoadJson(prev.state);
      this.errors.push(translateRuntime(e instanceof Error ? e.message : String(e)));
      return this.snapshot([]);
    }
    this.picks.push(payload ? { index, payload } : index);
    this.chosen.push({ text, at: this.log.length, ...(payload ? { payload } : {}) });
    const step = this.advance();
    const given = seq ?? this.nextSeq;
    this.nextSeq = Math.max(this.nextSeq, given + 1);
    const rolls = this.outcome?.().slice(rolled) ?? [];
    this.takenList.push({ index, text, lang, ...(payload ? { payload } : {}), seq: given, fp: fingerprint([...rolls, `choices:${step.choices.length}`]), offered, ...(write ? { write: true } : {}) });
    return step;
  }

  /** The latest choice of this run (text, and the index in `log` of the first paragraph after it); null after start, load or when undone. */
  get lastChoice(): Chosen | null {
    return this.chosen.at(-1) ?? null;
  }

  /** Every choice made in this run, oldest first; empty after a load (a save keeps the text, not the choices). */
  get choicesMade(): readonly Chosen[] {
    return this.chosen;
  }

  get canGoBack(): boolean {
    return this.history.length > 0;
  }

  /** Turn per paragraph, aligned with `log` (-1 before the first choice; null when loaded from a save). */
  get turns(): readonly (number | null)[] {
    return this.turnOf;
  }

  /** Undoes the last choice; null when there is nothing to undo. */
  back(): Step | null {
    const prev = this.history.pop();
    if (!prev) return null;
    this.story = this.attach(new Story(this.parsed));
    this.story.state.LoadJson(prev.state);
    this.log = this.log.slice(0, prev.logLength);
    this.turnOf = this.turnOf.slice(0, prev.logLength);
    this.picks.pop();
    this.chosen.pop();
    this.takenList.pop();
    // The asides asked after the choice taken back go with it.
    this.asideList = this.asideList.filter((a) => a.after <= this.takenList.length);
    this.errors = [];
    this.halted = false;
    return this.snapshot([]);
  }

  /** A snapshot to resume from later; null while a halted loop left the story mid-step. */
  save(): SaveData | null {
    if (this.halted) return null;
    return {
      state: this.story.state.ToJson(),
      log: this.log.map((p) => ({ ...p, tags: [...p.tags] })),
      startPoint: this.startPoint,
      ...(this.startState === null ? {} : { start: this.startState, picks: [...this.picks] }),
    };
  }

  /** Resumes from a save. If it does not fit this story, reports an error and keeps the current state. */
  load(save: SaveData): Step {
    const story = this.attach(new Story(this.parsed));
    try {
      story.state.LoadJson(save.state);
    } catch (e) {
      this.story = this.attach(this.story);
      this.errors = [T().loadFailed(e instanceof Error ? e.message : String(e))];
      return this.snapshot([]);
    }
    this.story = story;
    this.startPoint = save.startPoint;
    this.log = save.log.map((p) => ({ ...p, tags: [...p.tags] }));
    this.turnOf = this.log.map(() => null);
    this.history = [];
    this.chosen = [];
    this.takenList = [];
    this.asideList = [];
    this.errors = [];
    this.halted = false;
    this.startState = save.start ?? null;
    this.picks = [...(save.picks ?? [])];
    // Keep playing in the language chosen in this session, not the one the save was made in.
    if (this.preferredLanguage !== null && this.language !== this.preferredLanguage) {
      return this.setLanguage(this.preferredLanguage);
    }
    return this.snapshot([]);
  }

  /** The raw value of a global variable (number, boolean, string or InkList), or undefined. */
  read(name: string): unknown {
    return this.story.variablesState[name];
  }

  /** The names of the story's global variables, in declaration order. */
  globals(): string[] {
    const globals = (this.story.variablesState as unknown as { _globalVariables?: Map<string, unknown> })._globalVariables;
    return globals instanceof Map ? [...globals.keys()] : [];
  }

  /** Current variables and visit counts; empty while a halted loop left the story mid-step. */
  inspect(): Inspection {
    if (this.halted) return { variables: [], visits: [], turns: 0 };
    const result = inspect(this.story);
    // ChoosePathString (used by startAt) advances the turn index once; that is not a player choice.
    if (this.startPoint !== null) result.turns = Math.max(0, result.turns - 1);
    return result;
  }

  /**
   * Starts a run from a saved start state (an old save's), instead of the story's start: no `prepare`,
   * the state carries its own seeds. A state that does not fit the story is reported and nothing starts.
   */
  startFrom(state: string): Step {
    const story = this.attach(new Story(this.parsed));
    try {
      story.state.LoadJson(state);
    } catch (e) {
      this.errors = [T().loadFailed(e instanceof Error ? e.message : String(e))];
      this.halted = true;
      return this.snapshot([]);
    }
    this.story = story;
    this.log = [];
    this.turnOf = [];
    this.history = [];
    this.picks = [];
    this.chosen = [];
    this.takenList = [];
    this.asideList = [];
    this.errors = [];
    this.halted = false;
    this.applyLanguage();
    this.startState = this.story.state.ToJson();
    return this.advance();
  }

  /** Starts over from the current start point, with a fresh Story (works after a halted loop too). */
  restart(): Step {
    return this.startAt(this.startPoint);
  }

  /** Starts over from a knot or stitch ("knot" / "knot.stitch"), or from the beginning when null. */
  startAt(path: string | null): Step {
    this.startPoint = path;
    this.story = this.attach(new Story(this.parsed));
    this.log = [];
    this.turnOf = [];
    this.history = [];
    this.picks = [];
    this.chosen = [];
    this.takenList = [];
    this.asideList = [];
    this.startState = null;
    this.errors = [];
    this.halted = false;
    this.prepare?.(this.story);
    this.applyLanguage();
    if (path !== null) {
      try {
        this.story.ChoosePathString(path);
      } catch (e) {
        this.halted = true;
        this.errors.push(translateRuntime(e instanceof Error ? e.message : String(e)));
        return this.snapshot([]);
      }
    }
    this.startState = this.story.state.ToJson();
    return this.advance();
  }

  private applyLanguage(): void {
    if (this.languageVar !== null && this.preferredLanguage !== null) {
      this.story.variablesState[this.languageVar] = this.preferredLanguage;
    }
  }

  private attach(story: Story): Story {
    speedUpInkjs(story);
    // Like Inky: an EXTERNAL without a binding falls back to an ink function of the same name.
    story.allowExternalFunctionFallbacks = true;
    story.onError = (message: string) => {
      this.errors.push(translateRuntime(message));
    };
    this.setup?.(story);
    return story;
  }

  private advance(): Step {
    const paragraphs: Paragraph[] = [];
    const deadline = Date.now() + this.budget;
    while (this.story.canContinue) {
      // Time-sliced so a looping story can be stopped instead of freezing Obsidian.
      try {
        this.story.ContinueAsync(SLICE_MS);
      } catch (e) {
        this.halted = true;
        this.errors.push(translateRuntime(e instanceof Error ? e.message : String(e)));
        break;
      }
      if (this.story.asyncContinueComplete) {
        const text = (this.story.currentText ?? "").replace(/\n+$/, "");
        const tags = this.story.currentTags ?? [];
        if (text !== "" || tags.length > 0) {
          paragraphs.push({ text, tags: [...tags] });
          this.log.push({ text, tags: [...tags] });
          this.turnOf.push(this.story.state.currentTurnIndex);
        }
      }
      if (Date.now() > deadline) {
        this.halted = true;
        this.errors.push(T().infiniteLoop(this.budget / 1000));
        break;
      }
    }
    return this.snapshot(paragraphs);
  }

  private snapshot(paragraphs: Paragraph[]): Step {
    const choices = this.halted
      ? []
      : this.story.currentChoices.map((c) => ({ index: c.index, text: c.text, tags: c.tags ?? [] }));
    return {
      paragraphs,
      choices,
      ended: this.halted || (choices.length === 0 && !this.story.canContinue),
      errors: [...this.errors],
    };
  }
}

/** A short hash (FNV-1a) of what a choice led to. */
function fingerprint(parts: readonly string[]): string {
  let h = 0x811c9dc5;
  const s = parts.join("\n");
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}


/** What a payload writes: a card as a list item, several as one list, or text. */
function payloadValue(payload: Payload, story: Story): InkList | string {
  if ("item" in payload) return InkList.FromString(payload.item, story);
  if ("items" in payload) {
    let list = new InkList();
    for (const item of payload.items) list = list.Union(InkList.FromString(item, story));
    return list;
  }
  return payload.text;
}
