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
}

export interface SessionOptions {
  /** Max wall-clock time one step may run before it is treated as an infinite loop. */
  timeBudgetMs?: number;
}

const SLICE_MS = 20;

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

  constructor(story: Story, options: SessionOptions = {}) {
    this.json = story.ToJson() as string;
    this.budget = options.timeBudgetMs ?? 2000;
    this.story = this.attach(story);
  }

  start(): Step {
    this.errors = [];
    this.log = [];
    this.history = [];
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
    return this.advance();
  }

  get canGoBack(): boolean {
    return this.history.length > 0;
  }

  /** Undoes the last choice; null when there is nothing to undo. */
  back(): Step | null {
    const prev = this.history.pop();
    if (!prev) return null;
    this.story = this.attach(new Story(this.json));
    this.story.state.LoadJson(prev.state);
    this.log = this.log.slice(0, prev.logLength);
    this.errors = [];
    this.halted = false;
    return this.snapshot([]);
  }

  /** A snapshot to resume from later; null while a halted loop left the story mid-step. */
  save(): SaveData | null {
    if (this.halted) return null;
    return { state: this.story.state.ToJson(), log: this.log.map((p) => ({ ...p, tags: [...p.tags] })), startPoint: this.startPoint };
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
    this.history = [];
    this.errors = [];
    this.halted = false;
    return this.snapshot([]);
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
    this.log = [];
    this.history = [];
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
    return this.advance();
  }

  private attach(story: Story): Story {
    // Like Inky: an EXTERNAL without a binding falls back to an ink function of the same name.
    story.allowExternalFunctionFallbacks = true;
    story.onError = (message: string) => {
      this.errors.push(translateRuntime(message));
    };
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
      : this.story.currentChoices.map((c) => ({ index: c.index, text: c.text }));
    return {
      paragraphs,
      choices,
      ended: this.halted || (choices.length === 0 && !this.story.canContinue),
      errors: [...this.errors],
    };
  }
}
