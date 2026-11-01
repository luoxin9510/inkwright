import type { Story } from "inkjs/full";
import type { Payload } from "../play/session";
import { carries, collectModifiers, inkNames, localize, parseCheckTag, parseGoTag, parseNeedsTag, parsePlayTag, parseVoiceTag, playableCharacters, type CardDef, type CheckTag, type GameConfig, type LocalizedText } from "./config";
import { chance, formatFormula, parseFormula, resolve, rollFormula, seededDice, type Band, type Chance, type CheckResult, type Rng } from "./dice";
import { rowAt, tableFormula } from "./tables";

export interface EngineOptions {
  /** Random source for the dice; default: dice derived from the run's seed, so replays match. */
  rng?: Rng;
  /** When set, every check gets this band instead of rolling (explorers walk both outcomes this way). */
  force?: (check: CheckTag) => Band;
  /** How many rolls to keep in the log (default 20). */
  keepRolls?: number;
}

/** One resolved check, for the dice log. */
export interface CheckRecord extends CheckResult {
  kind: "check";
  skill: string;
  chance: Chance;
  /** Position of the check in its run: the story's roll counter before it. */
  index: number;
  /** The story's turn when the check was rolled (-1 before the first choice), to place it in the text. */
  turn: number;
  /** Set when the story named a skill the config does not have (a typo): rolled at level 0. */
  unknown?: true;
}

/** One free roll (`roll("2d6+3")`) or table roll (`table("encounter")`), for the dice log. */
export interface DiceRecord {
  kind: "dice";
  /** The formula as rolled (`2d6+3`, `d66`), or the text the story passed when it was not one. */
  formula: string;
  rolls: number[];
  total: number;
  /** Position in the run's roll counter, shared with the checks. */
  index: number;
  turn: number;
  /** Set when the formula could not be read: nothing rolled, total 0. */
  unknown?: true;
  /** For a table roll: the table and the row the total landed on (text in the engine's language). */
  table?: { id: string; name: string; text: string; rowId?: string };
  /** For a draw: the deck and the card that came out (named in the engine's language). */
  deck?: { id: string; name: string; card: string; cardId: string; desc?: string };
}

export type RollRecord = CheckRecord | DiceRecord;

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

export interface ItemView {
  id: string;
  name: string;
  desc?: string;
}

/** An item a choice needs (`#needs:<item>`), and whether it is carried. */
export interface ChoiceNeed {
  id: string;
  name: string;
  has: boolean;
  /** False when the config has no such item: a typo in the story, never satisfied. */
  known: boolean;
}

/** A card as the panel shows it: its deck, its name and description in the current language. */
export interface CardView {
  id: string;
  name: string;
  desc?: string;
  deck: string;
  deckName: string;
}

/** A hand (`hands` in the config) with the cards it holds now, in deck order. */
export interface HandView {
  id: string;
  name: string;
  cards: CardView[];
}

/** The hand a choice plays from (`#play:<hand>`), with its cards now; `known` is false when the config has no such hand. */
export interface ChoicePlay {
  hand: string;
  name: string;
  cards: CardView[];
  known: boolean;
}

/** A place as the map draws it: position in map units, whether it is revealed, whether the player is there, and which choice goes there. */
export interface PlaceView {
  id: string;
  name: string;
  x: number;
  y: number;
  links: string[];
  revealed: boolean;
  here: boolean;
  counter?: { name: string; value: number };
  /** Index of the choice tagged `#go:<this place>`, when one is offered. */
  go?: number;
}

export interface TokenView {
  id: string;
  name: string;
  color?: string;
  /** The place it stands on, or null when off the map. */
  at: string | null;
}

/** The map as the panel draws it; coordinates are in `width` x `height` units. */
export interface MapView {
  image?: string;
  width: number;
  height: number;
  places: PlaceView[];
  tokens: TokenView[];
}

/** A resource pushed outside its min..max by the story and clamped back. */
export interface Overflow {
  /** The resource id, or `<resource>_<character>` for a companion's. */
  resource: string;
  /** The value the story set before clamping. */
  value: number;
  min: number;
  max: number;
}

export interface HudView {
  character: { id: string; name: string; skills: { id: string; name: string; level: number }[] } | null;
  resources: ResourceView[];
  companions: { id: string; name: string; resources: ResourceView[] }[];
  /** What is carried, in config order; absent when the game has no items. */
  items?: ItemView[];
  /** Each deck's pile, absent when the game has no decks. */
  decks?: { id: string; name: string; left: number; total: number }[];
  /** Each hand's cards, absent when the game has no hands. */
  hands?: HandView[];
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
  private overflows: Overflow[] = [];

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
    // Lookahead-safe: a roll is read inline, often inside a bilingual string (`{t("…{table("x")}…", …)}`), where
    // ink forbids unsafe externals. Faces are a hash of (seed, index), so a call repeated by lookahead rolls the same.
    story.BindExternalFunction(inkNames(this.config).dice, (formula: unknown, label: unknown) => this.rollDice(formula, label), true);
    // A resource lives in min..max: whatever the story adds, it is clamped once the step is done
    // (inkjs tells observers after a Continue), and the overshoot is kept for the checkers.
    for (const r of this.resourceVariables()) {
      if (!story.variablesState.GlobalVariableExistsWithName(r.name)) continue;
      story.ObserveVariable(r.name, (_name: string, value: unknown) => {
        const v = Number(value);
        if (!Number.isFinite(v)) return;
        const c = Math.min(r.max, Math.max(r.min, v));
        if (c === v) return;
        this.overflows.push({ resource: r.name, value: v, min: r.min, max: r.max });
        story.variablesState[r.name] = c;
      });
    }
    this.start(story, character);
  }

  /** Every resource variable the config declares: the character's own and each character's companion ones. */
  private resourceVariables(): { name: string; min: number; max: number }[] {
    return [
      ...this.config.resources.map((r) => ({ name: r.id, min: r.min, max: r.max })),
      ...this.config.characters.flatMap((c) => (this.config.companionResources ?? []).map((r) => ({ name: `${r.id}_${c.id}`, min: r.min, max: r.max }))),
    ];
  }

  /** The overshoots clamped since the last call (oldest first), and forgets them. */
  takeOverflows(): Overflow[] {
    const out = this.overflows;
    this.overflows = [];
    return out;
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
    const modifiers = known ? collectModifiers(this.config, skill, (n) => this.read(n), this.language) : [];
    const input = { level, difficulty, modifiers };
    const run = this.run();
    const seed = run?.seed ?? 0;
    const index = run?.count ?? (this.log.at(-1)?.record.index ?? -1) + 1;
    const rng = this.rng ?? (run ? seededDice(seed, index) : Math.random);
    const forced = this.force?.({ skill, difficulty, red: false });
    const result = resolve(this.config.rules, input, rng, forced);
    if (run) this.write(inkNames(this.config).rolls, index + 1);
    const record: CheckRecord = { ...result, kind: "check", skill, index, turn: this.story?.state.currentTurnIndex ?? -1, chance: chance(this.config.rules, input) };
    if (!known) record.unknown = true;
    this.remember(seed, index, record);
    return result.band;
  }

  /** A free roll from the story (`roll_dice(formula, label)`): the label names a table when the roll is for one. */
  private rollDice(formulaArg: unknown, labelArg: unknown): number {
    const text = GameEngine.text(formulaArg) ?? "";
    const label = GameEngine.text(labelArg) ?? "";
    const table = label === "" ? undefined : this.config.tables?.find((t) => t.id === label);
    const deck = label === "" ? undefined : this.config.decks?.find((d) => d.id === label);
    // A table's dice come from the table itself, a deck's from its pile; the text is only what the generated ink passes along.
    const left = deck ? this.pile(deck.id, deck.cards) : [];
    const formula = table ? tableFormula(table) : deck ? { count: 1, sides: Math.max(1, left.length), bonus: 0, d66: false } : parseFormula(text);
    const run = this.run();
    const seed = run?.seed ?? 0;
    const index = run?.count ?? (this.log.at(-1)?.record.index ?? -1) + 1;
    const turn = this.story?.state.currentTurnIndex ?? -1;
    if (run) this.write(inkNames(this.config).rolls, index + 1);
    // ink's lookahead calls a lookahead-safe function, rewinds, then calls it again for real: the
    // same roll of the same run gives the faces it gave, so an injected rng is not drawn twice.
    const again = this.log.find((e) => e.seed === seed && e.record.index === index && e.record.kind === "dice" && e.record.formula === (formula ? formatFormula(formula) : text) && (e.record.table?.id ?? "") === (table?.id ?? "") && (e.record.deck?.id ?? "") === (deck?.id ?? ""));
    if (again) return again.record.total;
    if (!formula) {
      this.remember(seed, index, { kind: "dice", formula: text, rolls: [], total: 0, index, turn, unknown: true });
      return 0;
    }
    const rng = this.rng ?? (run ? seededDice(seed, index) : Math.random);
    const { rolls, total } = rollFormula(formula, rng);
    const record: DiceRecord = { kind: "dice", formula: formatFormula(formula), rolls, total, index, turn };
    if (table) {
      const hit = rowAt(table, total);
      record.table = {
        id: table.id, name: localize(table.name, this.language, table.id), text: hit ? localize(hit.row.text, this.language, "") : "",
        ...(hit?.row.id !== undefined ? { rowId: hit.row.id } : {}),
      };
    }
    if (deck) {
      const card = left[total - 1];
      const desc = card ? localize(card.desc, this.language, "") : "";
      record.deck = { id: deck.id, name: localize(deck.name, this.language, deck.id), card: card ? localize(card.name, this.language, card.id) : "", cardId: card?.id ?? "", ...(desc ? { desc } : {}) };
    }
    this.remember(seed, index, record);
    return total;
  }

  /** The cards still in a deck's pile, in list order (the generated ink draws the k-th lowest). */
  private pile(deck: string, cards: CardDef[]): CardDef[] {
    const pile = this.read(`${deck}${inkNames(this.config).pileSuffix}`);
    return cards.filter((c) => carries(pile, c.id));
  }

  /** Keeps a roll's record: rolling roll `index` again (back, replay) replaces it, other runs' records go. */
  private remember(seed: number, index: number, record: RollRecord): void {
    this.log = this.log.filter((e) => e.seed === seed && e.record.index < index);
    this.log.push({ seed, record });
    if (this.log.length > this.keepRolls) this.log.splice(0, this.log.length - this.keepRolls);
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
      const modifiers = collectModifiers(this.config, check.skill, (n) => this.read(n), this.language);
      return { ...check, level, modifiers, chance: chance(this.config.rules, { level, difficulty: check.difficulty, modifiers }) };
    }
    return null;
  }

  /** The items a choice needs (`#needs:<item>` tags), each with whether it is carried now. */
  needsOf(choice: { tags: string[] }): ChoiceNeed[] {
    const inventory = this.read(inkNames(this.config).inventory);
    const out: ChoiceNeed[] = [];
    for (const tag of choice.tags) {
      const id = parseNeedsTag(tag);
      if (id === null) continue;
      const item = this.config.items?.find((i) => i.id === id);
      out.push({ id, name: localize(item?.name, this.language, id), has: item !== undefined && carries(inventory, id), known: item !== undefined });
    }
    return out;
  }

  /** The hand a choice plays a card from (`#play:<hand>`), with the cards in it now; null for other choices. */
  playOf(choice: { tags: string[] }): ChoicePlay | null {
    for (const tag of choice.tags) {
      const id = parsePlayTag(tag);
      if (id === null) continue;
      const hand = this.config.hands?.find((h) => h.id === id);
      return { hand: id, name: localize(hand?.name, this.language, id), cards: hand ? this.cardsIn(id) : [], known: hand !== undefined };
    }
    return null;
  }

  /** What a `#play` choice is taken with: the card written into the played VAR. Null when the hand does not hold that card. */
  playPayload(hand: string, card: string): Payload | null {
    if (!this.cardsIn(hand).some((c) => c.id === card)) return null;
    return { var: inkNames(this.config).played, item: card };
  }

  /** The place a choice goes to (`#go:<place>`), or null. */
  goOf(choice: { tags: string[] }): string | null {
    for (const tag of choice.tags) {
      const id = parseGoTag(tag);
      if (id !== null) return id;
    }
    return null;
  }

  /** The map with the story's state read into it: where the player is, what is revealed, where tokens stand; null when the game has no map. */
  map(choices: { index: number; tags: string[] }[] = []): MapView | null {
    const def = this.config.map;
    if (!def || def.places.length === 0) return null;
    const names = inkNames(this.config);
    const here = this.read(names.here);
    const revealed = this.read(names.revealed);
    const goes = new Map<string, number>();
    for (const c of choices) {
      const place = this.goOf(c);
      if (place !== null && !goes.has(place)) goes.set(place, c.index);
    }
    const placeOf = (v: unknown): string | null => def.places.find((p) => carries(v, p.id))?.id ?? null;
    return {
      ...(def.image ? { image: def.image } : {}),
      width: def.width ?? 100,
      height: def.height ?? 100,
      places: def.places.map((p) => {
        const go = goes.get(p.id);
        const counter = p.counter === undefined ? undefined : { name: localize(p.counterName, this.language, p.counter), value: Number(this.read(p.counter) ?? 0) };
        return {
          id: p.id, name: localize(p.name, this.language, p.id), x: p.x, y: p.y, links: p.links ?? [],
          revealed: !p.hidden || carries(revealed, p.id), here: carries(here, p.id),
          ...(counter ? { counter } : {}), ...(go === undefined ? {} : { go }),
        };
      }),
      tokens: (def.tokens ?? []).map((t) => ({ id: t.id, name: localize(t.name, this.language, t.id), ...(t.color ? { color: t.color } : {}), at: placeOf(this.read(`${t.id}${names.atSuffix}`)) })),
    };
  }

  /** A card's name in the current language (its id when the config does not know it). */
  cardName(id: string): string {
    for (const d of this.config.decks ?? []) {
      const card = d.cards.find((c) => c.id === id);
      if (card) return localize(card.name, this.language, id);
    }
    return id;
  }

  /** False when the choice needs an item that is not carried (or does not exist), or plays from a hand with no card in it. */
  canChoose(choice: { tags: string[] }): boolean {
    const play = this.playOf(choice);
    return this.needsOf(choice).every((n) => n.has) && (play === null || (play.known && play.cards.length > 0));
  }

  /** The cards a hand variable holds, in deck order. */
  private cardsIn(hand: string): CardView[] {
    const list = this.read(hand);
    const out: CardView[] = [];
    for (const d of this.config.decks ?? []) {
      const deckName = localize(d.name, this.language, d.id);
      for (const c of d.cards) {
        if (!carries(list, c.id)) continue;
        const desc = localize(c.desc, this.language, "");
        out.push({ id: c.id, name: localize(c.name, this.language, c.id), ...(desc ? { desc } : {}), deck: d.id, deckName });
      }
    }
    return out;
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
      ...(this.config.items?.length ? { items: this.carried() } : {}),
      ...(this.config.decks?.length ? { decks: this.config.decks.map((d) => ({ id: d.id, name: name(d), left: this.pile(d.id, d.cards).length, total: d.cards.length })) } : {}),
      ...(this.config.hands?.length ? { hands: this.config.hands.map((h) => ({ id: h.id, name: name(h), cards: this.cardsIn(h.id) })) } : {}),
    };
  }

  /** The items carried now, in config order. */
  private carried(): ItemView[] {
    const inventory = this.read(inkNames(this.config).inventory);
    return (this.config.items ?? []).filter((i) => carries(inventory, i.id)).map((i) => {
      const desc = localize(i.desc, this.language, "");
      return { id: i.id, name: localize(i.name, this.language, i.id), ...(desc ? { desc } : {}) };
    });
  }
}
