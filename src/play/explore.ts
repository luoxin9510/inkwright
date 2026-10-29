import type { Story } from "inkjs/full";
import { PlaySession, type SaveData } from "./session";

export interface ExploreOptions {
  /** Max choices to make in total; endless loops stop here (default 5000). */
  maxSteps?: number;
  /** Language for a bilingual story. */
  language?: string;
  /** Per-step loop guard, as in PlaySession (default 1000 ms). */
  timeBudgetMs?: number;
}

export interface ExploreResult {
  /** Every ending reached, with the choice texts that lead there and the last line shown. */
  endings: { choices: string[]; lastText: string }[];
  /** Runtime errors, with the choice texts that lead to them. */
  errors: { choices: string[]; message: string }[];
  /** True when maxSteps ran out before every branch was played. */
  truncated: boolean;
}

/**
 * Plays every branch of a story breadth-first, for checking that all endings work.
 * Breadth-first so that a loop (a sticky "again" choice) cannot use up the step budget
 * before the other branches are tried.
 */
export function exploreStory(story: Story, options: ExploreOptions = {}): ExploreResult {
  const session = new PlaySession(story, { language: options.language, timeBudgetMs: options.timeBudgetMs ?? 1000 });
  const result: ExploreResult = { endings: [], errors: [], truncated: false };
  let steps = options.maxSteps ?? 5000;

  const queue: { save: SaveData; choices: string[]; available: { index: number; text: string }[] }[] = [];
  const first = session.start();
  for (const message of first.errors) result.errors.push({ choices: [], message });
  const start = session.save();
  if (first.ended) result.endings.push({ choices: [], lastText: session.log.at(-1)?.text ?? "" });
  else if (start && first.errors.length === 0) queue.push({ save: start, choices: [], available: first.choices });

  for (let node = queue.shift(); node; node = queue.shift()) {
    for (const choice of node.available) {
      if (steps-- <= 0) {
        result.truncated = true;
        return result;
      }
      session.load(node.save);
      const step = session.choose(choice.index);
      const path = [...node.choices, choice.text];
      for (const message of step.errors) result.errors.push({ choices: path, message });
      if (step.errors.length > 0) continue;
      if (step.ended) {
        result.endings.push({ choices: path, lastText: session.log.at(-1)?.text ?? "" });
        continue;
      }
      const next = session.save();
      if (next) queue.push({ save: next, choices: path, available: step.choices });
    }
  }
  return result;
}
