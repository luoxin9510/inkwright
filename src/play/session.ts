import { InkList, Story } from "inkjs/full";
import { translateRuntime } from "../compile/diagnostics";
import { T } from "../i18n";
import { inspect, type Inspection } from "./inspect";

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
export type Payload = { var: string; item: string } | { var: string; text: string };

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
}

/** A recorded choice to replay; `text` null for one recorded without it (an old save): checked by index only. */
export interface ReplayAction {
  index: number;
  text: string | null;
  lang: string | null;
  payload?: Payload;
  seq: number;
}

export interface ReplayOptions {
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
  /** The record of this run's choices (see Taken); empty after a load. */
  private takenList: Taken[] = [];
  /** The next seq to give a choice: seqs are never reused within a run, even after back. */
  private nextSeq = 0;
  /** State at the start point; null after loading a save made without one. */
  private startState: string | null = null;
  /** Choices made since startState. */
  private picks: Pick[] = [];
  /** The choices made in this run: their text and where the text they produced begins in `log`. */
  private chosen: Chosen[] = [];

  constructor(story: Story, options: SessionOptions = {}) {
    this.json = story.ToJson() as string;
    this.budget = options.timeBudgetMs ?? 2000;
    this.setup = options.setup;
    this.prepare = options.prepare;
    this.outcome = options.outcome;
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
    this.story = this.attach(new Story(this.json));
    this.story.state.LoadJson(this.startState);
    this.applyLanguage();
    this.startState = this.story.state.ToJson();
    this.log = [];
    this.turnOf = [];
    this.history = [];
    this.picks = [];
    this.chosen = [];
    this.takenList = [];
    this.errors = [];
    this.halted = false;
    let step = this.advance();
    picks.forEach((pick, i) => {
      const seq = seqs[i];
      step = typeof pick === "number" ? this.choose(pick, undefined, seq) : this.choose(pick.index, pick.payload, seq);
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
    // The constructor's Story is fresh: seeds go in before the language (already applied) matters to anything.
    this.prepare?.(this.story);
    this.applyLanguage();
    this.startState = this.story.state.ToJson();
    return this.advance();
  }

  /** The record of this run's choices, oldest first. */
  get taken(): readonly Taken[] {
    return this.takenList;
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
    const result = (done: number, stop: ReplayResult["stop"], aborted = false): ReplayResult => ({ step, done, stop, aborted });
    for (let i = 0; i < actions.length; i++) {
      if (options.signal?.aborted) return result(i, null, true);
      if (Date.now() - worked >= slice) {
        await (options.wait ?? (() => Promise.resolve()))();
        worked = Date.now();
        if (options.signal?.aborted) return result(i, null, true);
      }
      if (Date.now() - begun >= budget) return result(i, { at: i, reason: "budget" });
      const a = actions[i];
      const offered = this.halted ? undefined : this.story.currentChoices[a.index];
      const sameLanguage = a.lang === null || this.language === null || a.lang === this.language;
      if (!offered || (a.text !== null && sameLanguage && offered.text !== a.text)) return result(i, { at: i, reason: "mismatch" });
      step = this.choose(a.index, a.payload, a.seq);
      // The choice was taken, but its step stopped (a loop): what comes after it cannot be replayed.
      if (this.halted) return result(i + 1, { at: i + 1, reason: "error" });
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
    const lang = this.language;
    const rolled = this.outcome?.().length ?? 0;
    try {
      if (payload) this.story.variablesState[payload.var] = "item" in payload ? InkList.FromString(payload.item, this.story) : payload.text;
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
    this.takenList.push({ index, text, lang, ...(payload ? { payload } : {}), seq: given, fp: fingerprint([...rolls, `choices:${step.choices.length}`]) });
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
    this.story = this.attach(new Story(this.json));
    this.story.state.LoadJson(prev.state);
    this.log = this.log.slice(0, prev.logLength);
    this.turnOf = this.turnOf.slice(0, prev.logLength);
    this.picks.pop();
    this.chosen.pop();
    this.takenList.pop();
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
    const story = this.attach(new Story(this.json));
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
    const story = this.attach(new Story(this.json));
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
    this.story = this.attach(new Story(this.json));
    this.log = [];
    this.turnOf = [];
    this.history = [];
    this.picks = [];
    this.chosen = [];
    this.takenList = [];
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
