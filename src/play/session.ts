import { Story } from "inkjs/full";
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

export interface Step {
  paragraphs: Paragraph[];
  choices: Choice[];
  ended: boolean;
  errors: string[];
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
  picks?: number[];
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
  /** State at the start point; null after loading a save made without one. */
  private startState: string | null = null;
  /** Choices made since startState. */
  private picks: number[] = [];

  constructor(story: Story, options: SessionOptions = {}) {
    this.json = story.ToJson() as string;
    this.budget = options.timeBudgetMs ?? 2000;
    this.setup = options.setup;
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
    this.story = this.attach(new Story(this.json));
    this.story.state.LoadJson(this.startState);
    this.applyLanguage();
    this.startState = this.story.state.ToJson();
    this.log = [];
    this.turnOf = [];
    this.history = [];
    this.picks = [];
    this.errors = [];
    this.halted = false;
    let step = this.advance();
    for (const pick of picks) step = this.choose(pick);
    return { ...step, paragraphs: [] };
  }

  start(): Step {
    this.errors = [];
    this.log = [];
    this.turnOf = [];
    this.history = [];
    this.picks = [];
    this.startState = this.story.state.ToJson();
    return this.advance();
  }

  choose(index: number): Step {
    this.errors = [];
    if (this.halted) return this.snapshot([]);
    this.history.push({ state: this.story.state.ToJson(), logLength: this.log.length });
    try {
      this.story.ChooseChoiceIndex(index);
    } catch (e) {
      this.history.pop();
      this.errors.push(translateRuntime(e instanceof Error ? e.message : String(e)));
      return this.snapshot([]);
    }
    this.picks.push(index);
    return this.advance();
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

  /** Starts over from the current start point, with a fresh Story (works after a halted loop too). */
  restart(): Step {
    return this.startAt(this.startPoint);
  }

  /** Starts over from a knot or stitch ("knot" / "knot.stitch"), or from the beginning when null. */
  startAt(path: string | null): Step {
    this.startPoint = path;
    this.story = this.attach(new Story(this.json));
    this.applyLanguage();
    this.log = [];
    this.turnOf = [];
    this.history = [];
    this.picks = [];
    this.startState = null;
    this.errors = [];
    this.halted = false;
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
