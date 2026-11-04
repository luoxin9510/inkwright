import { Story } from "inkjs/full";
import { localize, type GameConfig } from "../game/config";
import { GameEngine, type CardView, type RollRecord } from "../game/engine";
import { inputOf, inputPlaceholder } from "./input";
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
  /**
   * Game mode: each resource (companions' as `fear_yi`) at the end of the runs: its spread and percentiles, how many
   * runs ended on its lowest and highest value, and how many pushed it outside min..max (the engine clamps it).
   */
  resources?: { resource: string; end: Spread; percentiles: Percentiles; atMin: number; atMax: number; outOfRange: number }[];
  /** Game mode: every table, how often it was rolled, and how often each row came up (rows never read count 0; `none` = totals no row covers). */
  tables?: TableCount[];
  /** Game mode: every deck, how often it was drawn from, and how often each card came out (cards never drawn count 0). */
  decks?: DeckCount[];
  /** Game mode: each check met (skill and difficulty), how often, and the share of successes (band 3 or 4). */
  checks?: CheckCount[];
}

export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface TableCount {
  table: string;
  name: string;
  rolls: number;
  perRun: number;
  rows: { range: string; id?: string; text: string; count: number }[];
  none: number;
}

export interface DeckCount {
  deck: string;
  name: string;
  draws: number;
  perRun: number;
  cards: { id: string; name: string; count: number }[];
}

export interface CheckCount {
  skill: string;
  difficulty: number;
  count: number;
  success: number;
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
  // Every roll of a run is kept, so the tables, decks and checks can be counted when it ends.
  const engine = options.game ? new GameEngine(options.game, { rng: random, keepRolls: Infinity }) : null;

  // Cards in the paths are named in the story's language.
  if (engine && options.language === "en") engine.language = "en";
  const tally = engine && options.game ? new Tally(options.game, engine.language) : null;
  // A fresh Story: the one given may be mid-play, and the engine binds its check function once per Story.
  const session = new PlaySession(new Story(story.ToJson() as string), {
    language: options.language,
    timeBudgetMs: options.timeBudgetMs ?? 1000,
    setup: engine ? (s) => engine.setup(s, options.character) : undefined,
  });
  const endings = new Map<string, { count: number; steps: number }>();
  const errors = new Map<string, { count: number; choices: string[] }>();
  const ends = new Map<string, { values: number[]; outOfRange: number; atMin: number; atMax: number }>();
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
      // A choice that plays from a hand is taken with a random card in it.
      const play = engine?.playOf(pick);
      // A random number of cards the choice takes (one, for most), picked at random from the hand.
      const picks: CardView[] = [];
      if (play && play.cards.length >= play.min) {
        const top = Math.min(play.max, play.cards.length);
        const k = play.min + Math.floor(random() * (top - play.min + 1));
        const pool = [...play.cards];
        for (let i = 0; i < k; i++) picks.push(...pool.splice(Math.floor(random() * pool.length), 1));
      }
      const card = picks.length === 1 ? picks[0] : null;
      const cardPayload = engine && play && picks.length > 0
        ? (play.max === 1 && card ? engine.playPayload(play.hand, card.id) : engine.playPayload(play.hand, picks.map((c) => c.id), play)) ?? undefined
        : undefined;
      // A choice that asks for a line of text gets the placeholder.
      const variable = play ? null : inputOf(pick);
      const payload = cardPayload ?? (variable === null ? undefined : { var: variable, text: inputPlaceholder(variable) });
      path.push(picks.length > 0 ? `${pick.text} ▸ ${picks.map((c) => c.name).join(" + ")}` : variable !== null ? `${pick.text} ▸ ${inputPlaceholder(variable)}` : pick.text);
      step = session.choose(pick.index, payload);
      steps++;
    }
    stepCounts.push(steps);
    if (!fault && step.ended) {
      const text = session.log.at(-1)?.text ?? "";
      const e = endings.get(text) ?? { count: 0, steps: 0 };
      endings.set(text, { count: e.count + 1, steps: e.steps + steps });
    }
    if (engine) {
      tally?.add(engine.rolls);
      const hud = engine.hud();
      const views = [...hud.resources.map((r) => ({ ...r, resource: r.id })), ...hud.companions.flatMap((c) => c.resources.map((r) => ({ ...r, resource: `${r.id}_${c.id}` })))];
      const overflowed = new Set(engine.takeOverflows().map((o) => o.resource));
      for (const v of views) {
        const e = ends.get(v.resource) ?? { values: [], outOfRange: 0, atMin: 0, atMax: 0 };
        e.values.push(v.value);
        if (overflowed.has(v.resource)) e.outOfRange++;
        if (v.value <= v.min) e.atMin++;
        if (v.value >= v.max) e.atMax++;
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
  if (engine) {
    result.resources = [...ends].map(([resource, e]) => ({ resource, end: spread(e.values), percentiles: percentiles(e.values), atMin: e.atMin, atMax: e.atMax, outOfRange: e.outOfRange }));
  }
  if (tally) Object.assign(result, tally.result(runs));
  return result;
}

/** Counts the rolls of many runs by table row, deck card and check. */
class Tally {
  private readonly rows = new Map<string, number[]>();
  private readonly none = new Map<string, number>();
  private readonly cards = new Map<string, Map<string, number>>();
  private readonly checks = new Map<string, CheckCount>();

  constructor(private readonly config: GameConfig, private readonly language: string) {
    for (const t of config.tables ?? []) this.rows.set(t.id, (t.rows ?? []).map(() => 0));
    for (const d of config.decks ?? []) this.cards.set(d.id, new Map(d.cards.map((c) => [c.id, 0])));
  }

  add(records: RollRecord[]): void {
    for (const r of records) {
      if (r.kind === "check") {
        const key = `${r.skill}\n${r.difficulty}`;
        const c = this.checks.get(key) ?? { skill: r.skill, difficulty: r.difficulty, count: 0, success: 0 };
        c.count++;
        if (r.band >= 3) c.success++;
        this.checks.set(key, c);
      } else if (r.table) {
        const rows = this.rows.get(r.table.id);
        if (rows && r.table.row !== undefined && r.table.row < rows.length) rows[r.table.row]++;
        else this.none.set(r.table.id, (this.none.get(r.table.id) ?? 0) + 1);
      } else if (r.deck) {
        const cards = this.cards.get(r.deck.id);
        if (cards && cards.has(r.deck.cardId)) cards.set(r.deck.cardId, (cards.get(r.deck.cardId) ?? 0) + 1);
      }
    }
  }

  result(runs: number): { tables: TableCount[]; decks: DeckCount[]; checks: CheckCount[] } {
    const lang = this.language;
    const tables = (this.config.tables ?? []).map((t): TableCount => {
      const counts = this.rows.get(t.id) ?? [];
      const none = this.none.get(t.id) ?? 0;
      const rolls = counts.reduce((a, b) => a + b, 0) + none;
      return {
        table: t.id, name: localize(t.name, lang, t.id), rolls, perRun: runs > 0 ? rolls / runs : 0,
        rows: (t.rows ?? []).map((row, i) => ({ range: row.range ?? String(i + 1), ...(row.id !== undefined ? { id: row.id } : {}), text: localize(row.text, lang, ""), count: counts[i] ?? 0 })),
        none,
      };
    });
    const decks = (this.config.decks ?? []).map((d): DeckCount => {
      const counts = this.cards.get(d.id) ?? new Map<string, number>();
      const draws = [...counts.values()].reduce((a, b) => a + b, 0);
      return {
        deck: d.id, name: localize(d.name, lang, d.id), draws, perRun: runs > 0 ? draws / runs : 0,
        cards: d.cards.map((c) => ({ id: c.id, name: localize(c.name, lang, c.id), count: counts.get(c.id) ?? 0 })),
      };
    });
    const checks = [...this.checks.values()].map((c) => ({ ...c, success: c.count > 0 ? c.success / c.count : 0 }));
    return { tables, decks, checks };
  }
}

/** Nearest-rank percentiles of the values (0 for none). */
function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { p10: 0, p50: 0, p90: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

function spread(values: number[]): Spread {
  if (values.length === 0) return { min: 0, mean: 0, max: 0 };
  return { min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) };
}
