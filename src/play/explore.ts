import { Story } from "inkjs/full";
import { inkNames, type GameConfig } from "../game/config";
import type { Band } from "../game/dice";
import { GameEngine } from "../game/engine";
import { formatValue } from "./inspect";
import { placeName, storyShape, type StoryShape } from "./relevance";
import { PlaySession, type SaveData } from "./session";

export interface ExploreOptions {
  /** Max choices to make in total (default 5000). */
  maxSteps?: number;
  /**
   * A spot (the same choices offered) is played on from at most this many different states
   * (default 10): a story whose resources differ on every path stays finite, a counting loop ends.
   * Not used with `novelty`.
   */
  statesPerSpot?: number;
  /**
   * Play on from a state only when it is new in some one respect at its spot: the value of a
   * variable that can change what happens next, or the visit count of a sequence. States that
   * differ only in what is printed, or only in a combination seen piecewise, are not played on.
   * Keeps a long game finite without cutting off the counting paths (a resource worn down to
   * its threshold) that the spot cap loses.
   */
  novelty?: boolean;
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

export interface Coverage {
  /** Knots, stitches and labels (as the author names them) that some played state had visited. */
  places: { total: number; reached: string[]; missed: string[] };
  /** Choice points: how many exist, were offered in some state, were actually taken. */
  choices: {
    total: number;
    offered: number;
    taken: number;
    /** Choice points never taken: where they are, and their text when they were at least offered. */
    missed: { place: string; text: string | null }[];
  };
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
  /** What the exploration got to. */
  coverage: Coverage;
  /**
   * Game mode: how many check outcomes were walked, and failed checks after which nothing
   * changed (no variable, same choices): the story's "failure must have consequences" rule.
   */
  checks?: {
    walked: number;
    noConsequence: { choices: string[]; skill: string; difficulty: number }[];
    /** Choices whose `#needs:` names an item the config does not have (each once). */
    unknownNeeds: { choice: string; item: string }[];
    /** Spots where every choice needs something not carried: the player is stuck there. */
    lockedOut: { choices: string[] }[];
    /** A resource (or a companion's, as `fear_yi`) the story pushed outside its min..max (the engine clamped it), first time each way. */
    outOfRange: { choices: string[]; resource: string; value: number; min: number; max: number }[];
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
  /** The choice point taken, as the story JSON names it. */
  point: string;
  /** The variables before the move (StateInfo.vars). */
  vars: string;
  plan: Band[];
  /** Whether the state this move starts from was fresh (not reached before) when it was queued. */
  fromFresh: boolean;
}

/** What a saved state looks like to the explorer. */
interface StateInfo {
  /** The parts that decide the future, canonical (see stateKey). */
  key: string;
  /** The choice points offered. */
  spot: string;
  /** The choice points offered, by choice index, with their text. */
  points: { path: string; text: string }[];
  /** Counted places visited so far. */
  visited: string[];
  /** Visit counts of the containers whose next line depends on them. */
  counts: Record<string, number>;
  /** The story's variables (without the engine's own), canonical: for "did anything change". */
  vars: string;
}

/**
 * Plays every branch of a story breadth-first, for checking that all endings work.
 * Breadth-first so that a loop (a sticky "again" choice) cannot use up the step budget
 * before the other branches are tried. In game mode every check met on a move is forced
 * to the planned outcome (success by default), and a sibling move is queued for each
 * other outcome, so both sides of every check get played. A state reached before is not played
 * on again, and a spot (the same choices offered) is played on from at most `statesPerSpot`
 * states, or, with `novelty`, only from states new in some one respect.
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
  const json = story.ToJson() as string;
  // In game mode a fresh Story per exploration: the engine binds the check function, which a Story takes only once.
  const session = new PlaySession(engine ? new Story(json) : story, {
    language: options.language,
    timeBudgetMs: options.timeBudgetMs ?? 1000,
    setup: engine ? (s) => engine.setup(s, options.character) : undefined,
  });
  // The engine's own bookkeeping changes on every check; it is not a consequence.
  const hidden = new Set(engine ? [inkNames(engine.config).seed, inkNames(engine.config).rolls] : []);
  const shape = storyShape(JSON.parse(json), session.globals());
  // The engine reads these itself (locked choices, the character): they decide the future too.
  for (const name of engine ? [inkNames(engine.config).inventory, inkNames(engine.config).current] : []) shape.relevant.add(name);
  // The engine's own functions (the preset loader, the check fallback) are code, not places.
  const engineCode = new Set(engine ? [inkNames(engine.config).select, inkNames(engine.config).check] : []);
  shape.places = shape.places.filter((p) => !engineCode.has(p.path.split(".")[0]));
  const result: ExploreResult = {
    endings: [], errors: [], truncated: false, cappedSpots: 0,
    coverage: { places: { total: shape.places.length, reached: [], missed: [] }, choices: { total: shape.choices.length, offered: 0, taken: 0, missed: [] } },
  };
  if (engine) result.checks = { walked: 0, noConsequence: [], unknownNeeds: [], lockedOut: [], outOfRange: [] };
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
  const seenRange = new Set<string>();
  /** Reports the resources the story pushed out of range on the way here; true when it pushed any. */
  const checkRange = (path: string[]): boolean => {
    if (!engine || !result.checks) return false;
    const overflows = engine.takeOverflows();
    for (const o of overflows) {
      const tag = `${o.resource}${o.value < o.min ? "<" : ">"}`;
      if (seenRange.has(tag)) continue;
      seenRange.add(tag);
      result.checks.outOfRange.push({ choices: path, ...o });
    }
    return overflows.length > 0;
  };
  let steps = options.maxSteps ?? 5000;
  const perSpot = options.statesPerSpot ?? 10;

  // Coverage: every state produced counts, played on or not.
  const reached = new Set<string>();
  const offered = new Map<string, string>();
  const taken = new Set<string>();
  const cover = (info: StateInfo) => {
    for (const p of info.visited) reached.add(p);
    for (const p of info.points) if (!offered.has(p.path)) offered.set(p.path, p.text);
  };

  // A state reached before is not expanded again: poking around a room in a different order,
  // or two branches that join with the same variables, lead to the same futures. A spot reached
  // in ever new states (a resource that differs on every path, a counter) is expanded perSpot
  // times, or, with novelty, when some one thing about it is new there.
  const seen = new Set<string>();
  const spots = new Map<string, number>();
  const capped = new Set<string>();
  // Novelty: at each spot, the values seen of each variable that matters. A number is new when
  // it stands differently to the constants it is compared with than any value seen there (a
  // threshold crossed), or when it is beyond the lowest/highest seen there with a threshold still
  // ahead in that direction (a resource being worn down towards one); a counter past its last
  // threshold can grow without being new. A number compared with no constant is new at every
  // new extreme. Anything else is new when unseen.
  const atoms = new Set<string>();
  const envelopes = new Map<string, { min: number; max: number }>();
  const novel = (info: StateInfo): boolean => {
    let fresh = false;
    const fact = (name: string, value: unknown) => {
      if (typeof value === "number") {
        const key = `${info.spot}\n${name}`;
        const thresholds = shape.thresholds.get(name);
        if (thresholds) {
          const side = thresholds.map((t) => (value < t ? "<" : value > t ? ">" : "=")).join("");
          const atom = `${key}${side}`;
          if (!atoms.has(atom)) {
            atoms.add(atom);
            fresh = true;
          }
        }
        const e = envelopes.get(key);
        if (!e) {
          envelopes.set(key, { min: value, max: value });
          fresh = true;
        } else if (value < e.min) {
          if (!thresholds || thresholds.some((t) => t < e.min)) fresh = true;
          e.min = value;
        } else if (value > e.max) {
          if (!thresholds || thresholds.some((t) => t > e.max)) fresh = true;
          e.max = value;
        }
        return;
      }
      const atom = `${info.spot}\n${name}=${formatValue(value)}`;
      if (atoms.has(atom)) return;
      atoms.add(atom);
      fresh = true;
    };
    fact("", "");
    for (const name of shape.relevant) fact(name, session.read(name));
    for (const [path, n] of Object.entries(info.counts)) fact(`#${path}`, n);
    return fresh;
  };
  const unseen = (info: StateInfo): boolean => {
    if (seen.has(info.key)) return false;
    seen.add(info.key);
    if (options.novelty) return novel(info);
    const n = spots.get(info.spot) ?? 0;
    if (n >= perSpot) {
      capped.add(info.spot);
      return false;
    }
    spots.set(info.spot, n + 1);
    return true;
  };

  const queue: Move[] = [];
  const first = session.start();
  for (const message of first.errors) result.errors.push({ choices: [], message });
  const start = session.save();
  checkRange([]);
  if (first.ended) result.endings.push({ choices: [], lastText: session.log.at(-1)?.text ?? "" });
  else if (start && first.errors.length === 0) {
    const info = stateInfo(start.state, hidden, shape);
    cover(info);
    if (unseen(info)) {
      const choices = open(first.choices);
      for (const choice of choices) queue.push({ save: start, path: [], choices, choice, point: info.points[choice.index]?.path ?? "", vars: info.vars, plan: [], fromFresh: true });
    }
  }

  // Breadth-first, so a loop cannot use up the budget; with novelty, depth-first: a run to an
  // extreme (the hours waited out, a fight to the last point) widens the envelopes early, and
  // the many states in between then need no playing on.
  const next = () => (options.novelty ? queue.pop() : queue.shift());
  for (let move = next(); move; move = next()) {
    if (steps-- <= 0) {
      result.truncated = true;
      break;
    }
    session.load(move.save);
    plan = move.plan;
    met = [];
    const step = session.choose(move.choice.index);
    taken.add(move.point);
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
    // A resource already at its limit cannot move, but the story meant it to: that is a consequence.
    const pushed = checkRange(path);
    if (step.ended) {
      result.endings.push({ choices: path, lastText: session.log.at(-1)?.text ?? "" });
      for (const p of session.inspect().visits) reached.add(p.path);
      continue;
    }
    const choices = open(step.choices);
    if (result.checks && step.choices.length > 0 && choices.length === 0) result.checks.lockedOut.push({ choices: path });
    const after = session.save();
    if (!after) continue;
    const info = stateInfo(after.state, hidden, shape);
    cover(info);
    if (result.checks) {
      const failed = met.filter((c) => c.band <= 1);
      const sameChoices = choices.length === move.choices.length && choices.every((c, i) => c.text === move.choices[i].text);
      if (failed.length > 0 && sameChoices && info.vars === move.vars && !pushed) {
        for (const c of failed) result.checks.noConsequence.push({ choices: path, skill: c.skill, difficulty: c.difficulty });
      }
    }
    // A sibling move exists to show its outcome's path, so it goes on once even into a state
    // seen before (a retry that changes nothing); from there the usual rule holds again.
    const fresh = unseen(info);
    if (fresh || (move.plan.length > 0 && move.fromFresh)) {
      for (const choice of choices) queue.push({ save: after, path, choices, choice, point: info.points[choice.index]?.path ?? "", vars: info.vars, plan: [], fromFresh: fresh });
    }
  }
  result.cappedSpots = capped.size;
  const places = shape.places.map((p) => p.name);
  result.coverage.places.reached = places.filter((p) => reached.has(p));
  result.coverage.places.missed = places.filter((p) => !reached.has(p));
  result.coverage.choices.offered = shape.choices.filter((c) => offered.has(c.path)).length;
  result.coverage.choices.taken = shape.choices.filter((c) => taken.has(c.path)).length;
  result.coverage.choices.missed = shape.choices.filter((c) => !taken.has(c.path)).map((c) => ({ place: c.place, text: offered.get(c.path) ?? null }));
  return result;
}

interface Flow {
  outputStream?: unknown;
  callstack?: { threads?: Record<string, unknown>[] };
  currentChoices?: { originalChoicePath?: string; text?: string }[];
}

/**
 * The parts of a state that decide its future: without the turn counters, the text just shown,
 * the last random and the engine's own variables (`hidden`); object keys sorted, since inkjs
 * writes visit counts and list items in the order they were first touched. Two states that
 * differ only in those (a RANDOM or TURNS_SINCE still to come) count as one. The spot is the
 * list of choice points offered.
 */
function stateInfo(state: string, hidden: Set<string>, shape: StoryShape): StateInfo {
  const j = JSON.parse(state) as Record<string, unknown>;
  delete j.turnIdx;
  delete j.turnIndices;
  delete j.previousRandom;
  delete j.storySeed;
  const vars = j.variablesState as Record<string, unknown> | undefined;
  for (const name of hidden) delete vars?.[name];
  const varsKey = JSON.stringify(canonical(vars ?? {}));
  const visitCounts = (j.visitCounts ?? {}) as Record<string, number>;
  const visited = Object.keys(visitCounts).map(placeName);
  const counts: Record<string, number> = {};
  for (const path of shape.counted) if (visitCounts[path] !== undefined) counts[path] = visitCounts[path];
  const points: { path: string; text: string }[] = [];
  const flows = j.flows;
  if (flows && typeof flows === "object") {
    for (const flow of Object.values(flows as Record<string, Flow>)) {
      delete flow.outputStream;
      // Thread numbers only count how many choice generations there were.
      for (const thread of flow.callstack?.threads ?? []) delete thread.threadIndex;
      for (const c of flow.currentChoices ?? []) points.push({ path: c.originalChoicePath ?? "", text: c.text ?? "" });
    }
  }
  return { key: JSON.stringify(canonical(j)), spot: points.map((p) => p.path).join("\n"), points, visited, counts, vars: varsKey };
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonical(o[k])]));
  }
  return v;
}
