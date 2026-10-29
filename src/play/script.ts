import type { Story } from "inkjs/full";
import { T } from "../i18n";
import type { Inspection } from "./inspect";
import { PlaySession, type Choice, type Step } from "./session";

export type TranscriptEntry =
  | { type: "text"; text: string; tags: string[] }
  | { type: "choice"; index: number; text: string };

export interface ScriptOptions {
  /** Knot or "knot.stitch" to start from; the beginning when omitted. */
  from?: string | null;
  /** Choices to make in order: an index, or text (exact match first, then substring). */
  choices?: Array<number | string>;
  /** Language for a bilingual story ("zh" / "en"); default: the story's own. */
  language?: string;
}

export interface ScriptResult extends Inspection {
  transcript: TranscriptEntry[];
  /** Choices available at the end. */
  choices: Choice[];
  ended: boolean;
  errors: string[];
}

/** Finds a choice by index, or by text (exact match first, then substring). */
export function pick(choices: Choice[], want: number | string): Choice | undefined {
  if (typeof want === "number") return choices.find((c) => c.index === want);
  return choices.find((c) => c.text === want) ?? choices.find((c) => c.text.includes(want));
}

/** Plays a story non-interactively, for agents and scripts. Stops at the first problem. */
export function playScript(story: Story, options: ScriptOptions = {}): ScriptResult {
  const session = new PlaySession(story, { language: options.language });
  const transcript: TranscriptEntry[] = [];
  const errors: string[] = [];
  const record = (step: Step) => {
    for (const p of step.paragraphs) transcript.push({ type: "text", text: p.text, tags: p.tags });
    errors.push(...step.errors);
  };

  let step = session.startAt(options.from ?? null);
  record(step);
  for (const want of options.choices ?? []) {
    if (errors.length > 0) break;
    if (step.ended) {
      errors.push(T().storyEnded);
      break;
    }
    const choice = pick(step.choices, want);
    if (!choice) {
      errors.push(T().choiceNotFound(String(want), step.choices.map((c) => c.text)));
      break;
    }
    transcript.push({ type: "choice", index: choice.index, text: choice.text });
    step = session.choose(choice.index);
    record(step);
  }
  return { transcript, choices: step.choices, ended: step.ended, errors, ...session.inspect() };
}
