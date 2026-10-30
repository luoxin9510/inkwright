import type { Story } from "inkjs/full";
import { collectModifiers, inkNames, localize, parseCheckTag, parseVoiceTag, playableCharacters, type CheckTag, type GameConfig, type LocalizedText } from "./config";
import { chance, resolve, seededDice, type Band, type Chance, type CheckResult, type Rng } from "./dice";

export interface EngineOptions {
  /** Random source for the dice; default: dice derived from the run's seed, so replays match. */
  rng?: Rng;
  /** When set, every check gets this band instead of rolling (explorers walk both outcomes this way). */
  force?: (check: CheckTag) => Band;
  /** How many rolls to keep in the log (default 20). */
  keepRolls?: number;
}

/** One resolved check, for the dice log. */
export interface RollRecord extends CheckResult {
  skill: string;
  chance: Chance;
  /** Position of the check in its run: the story's roll counter before it. */
  index: number;
  /** Set when the story named a skill the config does not have (a typo): rolled at level 0. */
  unknown?: true;
}

/** What the panel shows on a choice that is a check. */
export interface ChoiceCheck extends CheckTag {
  level: number;
  modifiers: { source: string; value: number }[];
  chance: Chance;
}

export interface ResourceView {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
}

export interface HudView {
  character: { id: string; name: string; skills: { id: string; name: string; level: number }[] } | null;
  resources: ResourceView[];
  companions: { id: string; name: string; resources: ResourceView[] }[];
}

/**
 * The rules engine for one game: binds the story's EXTERNAL check function (rolling with the
 * configured dice and the modifiers read from the story's state), loads the chosen character's
 * preset, and reads the state back for the panel. The story's variables stay the only state:
 * the engine writes just a dice seed per run and a roll counter into them, so back, load and
 * the language replay roll the same dice again; the log of faces is kept here, keyed by both.
 */
export class GameEngine {
  /** Language the HUD names are shown in (a code from config.languages, or the UI's). */
  language: string;
  private story: Story | null = null;
  private readonly bound = new WeakSet<Story>();
  private readonly rng: Rng | null;
  private readonly force?: (check: CheckTag) => Band;
  private readonly keepRolls: number;
  private log: { seed: number; record: RollRecord }[] = [];

  constructor(readonly config: GameConfig, options: EngineOptions = {}) {
    this.language = config.languages?.[0] ?? "zh";
    this.rng = options.rng ?? null;
    this.force = options.force;
    this.keepRolls = options.keepRolls ?? 20;
  }

  /**
   * Prepares a freshly built Story: binds the check function, seeds its dice and loads
   * `character`'s preset (a later LoadJson overrides seed and preset, which is what back/load/
   * language replay want). Pass it as PlaySession's `setup` so every rebuilt Story gets the same
   * treatment; a Story seen before is left as it is.
   */
  setup(story: Story, character?: string): void {
    this.story = story;
    if (this.bound.has(story)) return;
    this.bound.add(story);
    story.BindExternalFunction(inkNames(this.config).check, (skill: unknown, difficulty: unknown) => this.roll(skill, difficulty), false);
    this.start(story, character);
  }

  /** Seeds the dice and loads `character`'s preset: a new run on a Story whose state was just reset. */
  start(story: Story, character?: string): void {
    this.story = story;
    const names = inkNames(this.config);
    if (this.has(names.seed)) this.write(names.seed, 1 + Math.floor(Math.random() * 0x7fffffff));
    const id = character ?? playableCharacters(this.config)[0]?.id;
    if (id !== undefined && playableCharacters(this.config).some((c) => c.id === id)) story.EvaluateFunction(names.select, [id]);
  }

  /** The checks rolled so far in the current run, as far as the state has got (after back: fewer). */
  get rolls(): RollRecord[] {
    const run = this.run();
    return this.log.filter((e) => run === null || (e.seed === run.seed && e.record.index < run.count)).map((e) => e.record);
  }

  private roll(skillArg: unknown, difficultyArg: unknown): number {
    // The story passes the skill's name; its level is read from the state.
    const skill = GameEngine.text(skillArg) ?? "?";
    const known = this.config.skills.some((s) => s.id === skill);
    const level = known ? Number(this.read(skill) ?? 0) : 0;
    const difficulty = Number(difficultyArg);
    const modifiers = known ? collectModifiers(this.config, skill, (n) => this.read(n)) : [];
    const input = { level, difficulty, modifiers };
    const run = this.run();
    const seed = run?.seed ?? 0;
    const index = run?.count ?? (this.log.at(-1)?.record.index ?? -1) + 1;
    const rng = this.rng ?? (run ? seededDice(seed, index) : Math.random);
    const forced = this.force?.({ skill, difficulty, red: false });
    const result = resolve(this.config.rules, input, rng, forced);
    if (run) this.write(inkNames(this.config).rolls, index + 1);
    // Rolling check `index` again (back, replay) replaces its record; other runs' records go.
    this.log = this.log.filter((e) => e.seed === seed && e.record.index < index);
    const record: RollRecord = { ...result, skill, index, chance: chance(this.config.rules, input) };
    if (!known) record.unknown = true;
    this.log.push({ seed, record });
    if (this.log.length > this.keepRolls) this.log.splice(0, this.log.length - this.keepRolls);
    return result.band;
  }

  /** The run's dice seed and roll counter from the story's variables; null when the story lacks them. */
  private run(): { seed: number; count: number } | null {
    const names = inkNames(this.config);
    if (!this.has(names.seed) || !this.has(names.rolls)) return null;
    return { seed: Number(this.read(names.seed)), count: Number(this.read(names.rolls)) };
  }

  private has(name: string): boolean {
    return this.story?.variablesState.GlobalVariableExistsWithName(name) ?? false;
  }

  private read(name: string): unknown {
    return this.story?.variablesState[name];
  }

  private write(name: string, value: number): void {
    if (this.story) this.story.variablesState[name] = value;
  }

  /** Text form of a story value: ink lists print their items, primitives themselves. */
  private static text(v: unknown): string | null {
    switch (typeof v) {
      case "string": return v;
      case "number": case "boolean": return String(v);
      case "object": return v !== null && typeof (v as { toString?: unknown }).toString === "function" ? (v as { toString: () => string }).toString() : null;
      default: return null;
    }
  }

  /** The current character's id, from the story's state. */
  character(): string | null {
    const id = GameEngine.text(this.read(inkNames(this.config).current));
    return id !== null && playableCharacters(this.config).some((c) => c.id === id) ? id : null;
  }

  /** Check info for a choice, with the odds given the current state; null when it is not a check. */
  describeChoice(choice: { tags: string[] }): ChoiceCheck | null {
    for (const tag of choice.tags) {
      const check = parseCheckTag(tag, this.config);
      if (!check) continue;
      const level = Number(this.read(check.skill) ?? 0);
      const modifiers = collectModifiers(this.config, check.skill, (n) => this.read(n));
      return { ...check, level, modifiers, chance: chance(this.config.rules, { level, difficulty: check.difficulty, modifiers }) };
    }
    return null;
  }

  /** The skill speaking in a paragraph (from its `voice:` tag), or null. */
  voiceOf(paragraph: { tags: string[] }): string | null {
    for (const tag of paragraph.tags) {
      const skill = parseVoiceTag(tag, this.config);
      if (skill) return skill;
    }
    return null;
  }

  hud(): HudView {
    const current = this.character();
    const name = (x: { id: string; name?: LocalizedText }) => localize(x.name, this.language, x.id);
    const view = (r: { id: string; name?: LocalizedText; min: number; max: number }, variable: string): ResourceView => ({
      id: r.id, name: name(r), value: Number(this.read(variable) ?? 0), min: r.min, max: r.max,
    });
    const character = this.config.characters.find((c) => c.id === current);
    return {
      character: character
        ? { id: character.id, name: name(character), skills: this.config.skills.map((s) => ({ id: s.id, name: name(s), level: Number(this.read(s.id) ?? 0) })) }
        : null,
      resources: this.config.resources.map((r) => view(r, r.id)),
      companions: this.config.characters
        .filter((c) => c.id !== current)
        .map((c) => ({ id: c.id, name: name(c), resources: (this.config.companionResources ?? []).map((r) => view(r, `${r.id}_${c.id}`)) })),
    };
  }
}
