import { Story } from "inkjs/full";
import { inkNames, type GameConfig } from "../game/config";
import type { Band } from "../game/dice";
import { GameEngine } from "../game/engine";
import { PlaySession, type SaveData } from "./session";

export interface ExploreOptions {
  /** Max choices to make in total; endless loops stop here (default 5000). */
  maxSteps?: number;
  /** Language for a bilingual story. */
  language?: string;
  /** Per-step loop guard, as in PlaySession (default 1000 ms). */
  timeBudgetMs?: number;
  /** Game mode: play with this config, walking every outcome of each check instead of rolling. */
  game?: GameConfig;
  /** Character to play in game mode (default: the first). */
  character?: string;
  /** Outcomes to walk per check, the first being the default (default [3, 1]: success and failure). */
  bands?: Band[];
}

export interface ExploreResult {
  /** Every ending reached, with the choice texts that lead there and the last line shown. */
  endings: { choices: string[]; lastText: string }[];
  /** Runtime errors, with the choice texts that lead to them. */
  errors: { choices: string[]; message: string }[];
  /** True when maxSteps ran out before every branch was played. */
  truncated: boolean;
  /**
   * Game mode: how many check outcomes were walked, and failed checks after which nothing
   * changed (no variable, same choices): the story's "failure must have consequences" rule.
   */
  checks?: { walked: number; noConsequence: { choices: string[]; skill: string; difficulty: number }[] };
}

/** How a forced outcome shows in a path: `撬开门 [strength✗]`. */
const MARK: Record<Band, string> = { 0: "✗✗", 1: "✗", 2: "~", 3: "✓", 4: "✓✓" };

interface ChoiceRef {
  index: number;
  text: string;
}

/** One choice to make from a saved state; `plan` fixes the outcomes of the checks it meets. */
interface Move {
  save: SaveData;
  path: string[];
  choices: ChoiceRef[];
  choice: ChoiceRef;
  plan: Band[];
}

/**
 * Plays every branch of a story breadth-first, for checking that all endings work.
 * Breadth-first so that a loop (a sticky "again" choice) cannot use up the step budget
 * before the other branches are tried. In game mode every check met on a move is forced
 * to the planned outcome (success by default), and a sibling move is queued for each
 * other outcome, so both sides of every check get played.
 */
export function exploreStory(story: Story, options: ExploreOptions = {}): ExploreResult {
  const bands: Band[] = options.bands?.length ? options.bands : [3, 1];
  // Checks met while making the current move: planned outcomes first, then the default.
  let plan: Band[] = [];
  let met: { skill: string; difficulty: number; band: Band }[] = [];
  const engine = options.game
    ? new GameEngine(options.game, {
      force: (check) => {
        const band = plan[met.length] ?? bands[0];
        met.push({ skill: check.skill, difficulty: check.difficulty, band });
        return band;
      },
    })
    : null;
  // In game mode a fresh Story per exploration: the engine binds the check function, which a Story takes only once.
  const session = new PlaySession(engine ? new Story(story.ToJson() as string) : story, {
    language: options.language,
    timeBudgetMs: options.timeBudgetMs ?? 1000,
    setup: engine ? (s) => engine.setup(s, options.character) : undefined,
  });
  // The engine's own bookkeeping changes on every check; it is not a consequence.
  const hidden = new Set(engine ? [inkNames(engine.config).seed, inkNames(engine.config).rolls] : []);
  const variables = () => JSON.stringify(session.inspect().variables.filter((v) => !hidden.has(v.name)));
  const result: ExploreResult = { endings: [], errors: [], truncated: false };
  if (engine) result.checks = { walked: 0, noConsequence: [] };
  let steps = options.maxSteps ?? 5000;

  const queue: Move[] = [];
  const first = session.start();
  for (const message of first.errors) result.errors.push({ choices: [], message });
  const start = session.save();
  if (first.ended) result.endings.push({ choices: [], lastText: session.log.at(-1)?.text ?? "" });
  else if (start && first.errors.length === 0) {
    for (const choice of first.choices) queue.push({ save: start, path: [], choices: first.choices, choice, plan: [] });
  }

  for (let move = queue.shift(); move; move = queue.shift()) {
    if (steps-- <= 0) {
      result.truncated = true;
      return result;
    }
    session.load(move.save);
    const before = engine ? variables() : null;
    plan = move.plan;
    met = [];
    const step = session.choose(move.choice.index);
    const label = met.length > 0 ? `${move.choice.text} [${met.map((c) => c.skill + MARK[c.band]).join(" ")}]` : move.choice.text;
    const path = [...move.path, label];
    // A check met for the first time on this move gets a sibling move per other outcome.
    for (let k = move.plan.length; k < met.length; k++) {
      for (const band of bands) {
        if (band !== met[k].band) queue.push({ ...move, plan: [...met.slice(0, k).map((c) => c.band), band] });
      }
    }
    // Outcomes walked for the first time: the new checks, plus the alternative a sibling move came for.
    if (result.checks) result.checks.walked += met.length - move.plan.length + (move.plan.length > 0 ? 1 : 0);
    for (const message of step.errors) result.errors.push({ choices: path, message });
    if (step.errors.length > 0) continue;
    if (step.ended) {
      result.endings.push({ choices: path, lastText: session.log.at(-1)?.text ?? "" });
      continue;
    }
    if (result.checks && before !== null) {
      const failed = met.filter((c) => c.band <= 1);
      const sameChoices = step.choices.length === move.choices.length && step.choices.every((c, i) => c.text === move.choices[i].text);
      if (failed.length > 0 && sameChoices && variables() === before) {
        for (const c of failed) result.checks.noConsequence.push({ choices: path, skill: c.skill, difficulty: c.difficulty });
      }
    }
    const next = session.save();
    if (next) {
      for (const choice of step.choices) queue.push({ save: next, path, choices: step.choices, choice, plan: [] });
    }
  }
  return result;
}
