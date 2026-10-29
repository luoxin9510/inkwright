import { Story } from "inkjs/full";
import { translateRuntime } from "../compile/diagnostics";
import { T } from "../i18n";

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

  constructor(story: Story, options: SessionOptions = {}) {
    this.json = story.ToJson() as string;
    this.budget = options.timeBudgetMs ?? 2000;
    this.story = this.attach(story);
  }

  start(): Step {
    this.errors = [];
    return this.advance();
  }

  choose(index: number): Step {
    this.errors = [];
    if (this.halted) return this.snapshot([]);
    try {
      this.story.ChooseChoiceIndex(index);
    } catch (e) {
      this.errors.push(translateRuntime(e instanceof Error ? e.message : String(e)));
      return this.snapshot([]);
    }
    return this.advance();
  }

  /** Starts over from a fresh Story, which also works after a halted loop. */
  restart(): Step {
    this.story = this.attach(new Story(this.json));
    this.errors = [];
    this.halted = false;
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
        if (text !== "" || tags.length > 0) paragraphs.push({ text, tags: [...tags] });
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
