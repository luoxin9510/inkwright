import { Story } from "inkjs/full";
import { inkNames, type GameConfig } from "../game/config";
import type { Band } from "../game/dice";
import { GameEngine } from "../game/engine";
import { PlaySession, type SaveData } from "./session";

export interface ExploreOptions {
  /** Max choices to make in total (default 5000). */
  maxSteps?: number;
  /**
   * A spot (the same choices offered) is played on from at most this many different states
   * (default 10): a story whose resources differ on every path stays finite, a counting loop ends.
   */
  statesPerSpot?: number;
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
  /** Spots reached in more states than statesPerSpot; the extra states were not played on. */
  cappedSpots: number;
  /**
   * Game mode: how many check outcomes were walked, and failed checks after which nothing
   * changed (no variable, same choices): the story's "failure must have consequences" rule.
   */
  checks?: {
    walked: number;
    noConsequence: { choices: string[]; skill: string; difficulty: number }[];
    /** Choices whose `#needs:` names an item the config does not have (each once). */
    unknownNeeds: { choice: string; item: string }[];
  };
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
  /** Whether the state this move starts from was fresh (not reached before) when it was queued. */
  fromFresh: boolean;
}

/**
 * Plays every branch of a story breadth-first, for checking that all endings work.
 * Breadth-first so that a loop (a sticky "again" choice) cannot use up the step budget
 * before the other branches are tried. In game mode every check met on a move is forced
 * to the planned outcome (success by default), and a sibling move is queued for each
 * other outcome, so both sides of every check get played. A state reached before is not played
 * on again, and a spot (the same choices offered) is played on from at most `statesPerSpot` states.
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
  const result: ExploreResult = { endings: [], errors: [], truncated: false, cappedSpots: 0 };
  if (engine) result.checks = { walked: 0, noConsequence: [], unknownNeeds: [] };
  // Game mode: a choice that needs an item not carried cannot be taken, so it is not played.
  const seenUnknown = new Set<string>();
  const open = <C extends { text: string; tags: string[] }>(choices: C[]): C[] => {
    if (!engine) return choices;
    return choices.filter((c) => {
      for (const n of engine.needsOf(c)) {
        if (!n.known && !seenUnknown.has(`${c.text}\n${n.id}`)) {
          seenUnknown.add(`${c.text}\n${n.id}`);
          result.checks?.unknownNeeds.push({ choice: c.text, item: n.id });
        }
      }
      return engine.canChoose(c);
    });
  };
  let steps = options.maxSteps ?? 5000;
  const perSpot = options.statesPerSpot ?? 10;

  // A state reached before is not expanded again: poking around a room in a different order,
  // or two branches that join with the same variables, lead to the same futures. A spot reached
  // in ever new states (a resource that differs on every path, a counter) is expanded perSpot times.
  const seen = new Set<string>();
  const spots = new Map<string, number>();
  const capped = new Set<string>();
  const unseen = (save: SaveData): boolean => {
    const key = stateKey(save.state, hidden);
    if (seen.has(key.state)) return false;
    seen.add(key.state);
    const n = spots.get(key.spot) ?? 0;
    if (n >= perSpot) {
      capped.add(key.spot);
      return false;
    }
    spots.set(key.spot, n + 1);
    return true;
  };

  const queue: Move[] = [];
  const first = session.start();
  for (const message of first.errors) result.errors.push({ choices: [], message });
  const start = session.save();
  if (first.ended) result.endings.push({ choices: [], lastText: session.log.at(-1)?.text ?? "" });
  else if (start && first.errors.length === 0 && unseen(start)) {
    const choices = open(first.choices);
    for (const choice of choices) queue.push({ save: start, path: [], choices, choice, plan: [], fromFresh: true });
  }

  for (let move = queue.shift(); move; move = queue.shift()) {
    if (steps-- <= 0) {
      result.truncated = true;
      break;
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
    const choices = open(step.choices);
    if (result.checks && before !== null) {
      const failed = met.filter((c) => c.band <= 1);
      const sameChoices = choices.length === move.choices.length && choices.every((c, i) => c.text === move.choices[i].text);
      if (failed.length > 0 && sameChoices && variables() === before) {
        for (const c of failed) result.checks.noConsequence.push({ choices: path, skill: c.skill, difficulty: c.difficulty });
      }
    }
    const next = session.save();
    if (next) {
      // A sibling move exists to show its outcome's path, so it goes on once even into a state
      // seen before (a retry that changes nothing); from there the usual rule holds again.
      const fresh = unseen(next);
      if (fresh || (move.plan.length > 0 && move.fromFresh)) {
        for (const choice of choices) queue.push({ save: next, path, choices, choice, plan: [], fromFresh: fresh });
      }
    }
  }
  result.cappedSpots = capped.size;
  return result;
}

/**
 * The parts of a state that decide its future: without the turn counters, the text just shown,
 * the last random and the engine's own variables (`hidden`); object keys sorted, since inkjs
 * writes visit counts and list items in the order they were first touched. Two states that
 * differ only in those (a RANDOM or TURNS_SINCE still to come) count as one. The spot is the
 * list of choice points offered.
 */
function stateKey(state: string, hidden: Set<string>): { state: string; spot: string } {
  const j = JSON.parse(state) as Record<string, unknown>;
  delete j.turnIdx;
  delete j.turnIndices;
  delete j.previousRandom;
  delete j.storySeed;
  const vars = j.variablesState as Record<string, unknown> | undefined;
  for (const name of hidden) delete vars?.[name];
  const spot: string[] = [];
  const flows = j.flows;
  if (flows && typeof flows === "object") {
    for (const flow of Object.values(flows as Record<string, Record<string, unknown>>)) {
      delete flow.outputStream;
      // Thread numbers only count how many choice generations there were.
      const threads = (flow.callstack as { threads?: Record<string, unknown>[] } | undefined)?.threads;
      for (const thread of threads ?? []) delete thread.threadIndex;
      for (const c of (flow.currentChoices as { originalChoicePath?: string }[] | undefined) ?? []) spot.push(c.originalChoicePath ?? "");
    }
  }
  return { state: JSON.stringify(canonical(j)), spot: spot.join("\n") };
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonical(o[k])]));
  }
  return v;
}
