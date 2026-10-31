import { Story } from "inkjs/full";
import type { GameConfig } from "../game/config";
import { GameEngine } from "../game/engine";
import { PlaySession } from "./session";

export interface SimulateOptions {
  /** How many runs (default 100). */
  runs?: number;
  /** Seed for the choices and, in game mode, the dice: the same seed gives the same runs (default 1). */
  seed?: number;
  /** Choices per run before it is given up as endless (default 1000). */
  maxSteps?: number;
  /** Language for a bilingual story. */
  language?: string;
  /** Per-step loop guard, as in PlaySession (default 1000 ms). */
  timeBudgetMs?: number;
  /** Game mode: play with this config and real dice. */
  game?: GameConfig;
  /** Character to play in game mode (default: the first). */
  character?: string;
}

export interface Spread {
  min: number;
  mean: number;
  max: number;
}

export interface SimulateResult {
  runs: number;
  /** Endings by their last line, most frequent first, with the mean number of choices to get there. */
  endings: { lastText: string; count: number; steps: number }[];
  /** Runs that ran out of steps. */
  truncated: number;
  /** Runs that came to a spot where every choice was locked. */
  stuck: number;
  /** Runtime errors met, each once with how many runs hit it and the choices of the first run that did. */
  errors: { message: string; count: number; choices: string[] }[];
  /** Choices per run. */
  steps: Spread;
  /** Game mode: each resource (companions' as `fear_yi`) at the end of the runs, and how many runs pushed it outside min..max (the engine clamps it). */
  resources?: { resource: string; end: Spread; outOfRange: number }[];
}

/** A small seeded generator (mulberry32), so a simulation can be repeated. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays a story many times choosing at random (and in game mode rolling real dice), and
 * reports where the runs end up and what the resources look like there: the odds of each
 * ending and the balance of a game, which exhaustive exploration cannot tell.
 */
export function simulateStory(story: Story, options: SimulateOptions = {}): SimulateResult {
  const runs = options.runs ?? 100;
  const maxSteps = options.maxSteps ?? 1000;
  const random = seededRandom(options.seed ?? 1);
  const engine = options.game ? new GameEngine(options.game, { rng: random }) : null;
  // A fresh Story: the one given may be mid-play, and the engine binds its check function once per Story.
  const session = new PlaySession(new Story(story.ToJson() as string), {
    language: options.language,
    timeBudgetMs: options.timeBudgetMs ?? 1000,
    setup: engine ? (s) => engine.setup(s, options.character) : undefined,
  });
  const endings = new Map<string, { count: number; steps: number }>();
  const errors = new Map<string, { count: number; choices: string[] }>();
  const ends = new Map<string, { values: number[]; outOfRange: number }>();
  const stepCounts: number[] = [];
  let truncated = 0;
  let stuck = 0;
  for (let i = 0; i < runs; i++) {
    let step = i === 0 ? session.start() : session.restart();
    let steps = 0;
    let fault = false;
    const path: string[] = [];
    for (;;) {
      for (const message of step.errors) {
        const e = errors.get(message) ?? { count: 0, choices: path };
        errors.set(message, { count: e.count + 1, choices: e.choices });
        fault = true;
      }
      if (fault || step.ended) break;
      const open = engine ? step.choices.filter((c) => engine.canChoose(c)) : step.choices;
      if (open.length === 0) {
        stuck++;
        break;
      }
      if (steps >= maxSteps) {
        truncated++;
        break;
      }
      const pick = open[Math.floor(random() * open.length)];
      path.push(pick.text);
      step = session.choose(pick.index);
      steps++;
    }
    stepCounts.push(steps);
    if (!fault && step.ended) {
      const text = session.log.at(-1)?.text ?? "";
      const e = endings.get(text) ?? { count: 0, steps: 0 };
      endings.set(text, { count: e.count + 1, steps: e.steps + steps });
    }
    if (engine) {
      const hud = engine.hud();
      const views = [...hud.resources.map((r) => ({ ...r, resource: r.id })), ...hud.companions.flatMap((c) => c.resources.map((r) => ({ ...r, resource: `${r.id}_${c.id}` })))];
      const overflowed = new Set(engine.takeOverflows().map((o) => o.resource));
      for (const v of views) {
        const e = ends.get(v.resource) ?? { values: [], outOfRange: 0 };
        e.values.push(v.value);
        if (overflowed.has(v.resource)) e.outOfRange++;
        ends.set(v.resource, e);
      }
    }
  }
  const result: SimulateResult = {
    runs,
    endings: [...endings].map(([lastText, e]) => ({ lastText, count: e.count, steps: e.steps / e.count })).sort((a, b) => b.count - a.count),
    truncated,
    stuck,
    errors: [...errors].map(([message, e]) => ({ message, count: e.count, choices: e.choices })),
    steps: spread(stepCounts),
  };
  if (engine) result.resources = [...ends].map(([resource, e]) => ({ resource, end: spread(e.values), outOfRange: e.outOfRange }));
  return result;
}

function spread(values: number[]): Spread {
  if (values.length === 0) return { min: 0, mean: 0, max: 0 };
  return { min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) };
}
