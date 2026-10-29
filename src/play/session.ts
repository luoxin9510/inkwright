import type { Story } from "inkjs/full";

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

export class PlaySession {
  private errors: string[] = [];

  constructor(private readonly story: Story) {
    story.onError = (message: string) => {
      this.errors.push(message);
    };
  }

  start(): Step {
    return this.advance();
  }

  choose(index: number): Step {
    try {
      this.story.ChooseChoiceIndex(index);
    } catch (e) {
      this.errors.push(e instanceof Error ? e.message : String(e));
      return this.snapshot([]);
    }
    return this.advance();
  }

  restart(): Step {
    this.story.ResetState();
    this.errors = [];
    return this.advance();
  }

  private advance(): Step {
    const paragraphs: Paragraph[] = [];
    while (this.story.canContinue) {
      const text = (this.story.Continue() ?? "").replace(/\n+$/, "");
      const tags = this.story.currentTags ?? [];
      if (text !== "" || tags.length > 0) paragraphs.push({ text, tags: [...tags] });
    }
    return this.snapshot(paragraphs);
  }

  private snapshot(paragraphs: Paragraph[]): Step {
    const choices = this.story.currentChoices.map((c) => ({ index: c.index, text: c.text }));
    return {
      paragraphs,
      choices,
      ended: choices.length === 0 && !this.story.canContinue,
      errors: [...this.errors],
    };
  }
}
