import { parseFormula, tokenId, type Modifier, type RulesConfig } from "./dice";
import { shapeProblem, type DungeonDef, type ShapeDef } from "./dungeon";
import { tableProblems } from "./tables";
import { statusEntries } from "./statuses";

/** How likely a "yes" from the dice tray's oracle is, most likely first (see src/play/oracle.ts). */
export const ODDS = ["certain", "likely", "even", "unlikely", "remote"] as const;
export type Odds = (typeof ODDS)[number];

/** `oracle:` in the game note. */
export interface OracleConfig {
  /** Thresholds that differ from the defaults. */
  odds?: Partial<Record<Odds, number>>;
  /** A resource whose value moves every threshold: above its middle more yeses, below fewer. */
  chaos?: string;
  /** Points a threshold moves per point of chaos away from its middle (default 5). */
  chaosStep?: number;
}

/**
 * A game's rules as data. Nothing here names a particular game: skills,
 * resources, characters and modifier rules all come from the author's notes.
 * Ids are code (ink identifiers, tags); what the player reads is a
 * LocalizedText, so a game can show every language its story plays in.
 */

/** Player-facing text: one string, or one per language code (`{ zh: 洞察力, en: Insight }`). */
export type LocalizedText = string | Record<string, string>;

/** The text in `lang`, else the first language given, else `fallback` (usually the id). */
export function localize(text: LocalizedText | undefined | null, lang: string, fallback: string): string {
  if (typeof text === "string") return text;
  if (text && typeof text === "object") return text[lang] ?? Object.values(text)[0] ?? fallback;
  return fallback;
}

export interface SkillDef {
  /** Also the ink variable name, so it must be a valid ink identifier. */
  id: string;
  /** Display name; defaults to the id. */
  name?: LocalizedText;
  /** How this skill speaks when it interjects as an inner voice. */
  voice?: { stance?: LocalizedText; color?: string };
  /** Highest level (default 6). */
  max?: number;
}

export interface ResourceDef {
  id: string;
  name?: LocalizedText;
  min: number;
  max: number;
  initial: number;
  /** How the panel draws it: a bar (default), a clock of max−min segments, or a track of (max−min)/4 boxes of four ticks. */
  display?: "bar" | "clock" | "track";
  /** The player may change it by hand on the HUD (the player is the game master). */
  manual?: boolean;
  /** A story variable: shown on the HUD only while it is true, non-zero or not empty (e.g. one mode of a game). */
  when?: string;
}

export interface CharacterDef {
  id: string;
  name?: LocalizedText;
  /** Starting skill levels when played; keys are skill ids. */
  skills: Record<string, number>;
  /** Starting companion resource values when not played; keys are companionResources ids. */
  companion?: Record<string, number>;
  /** False for a companion the player can never pick (default true). */
  playable?: boolean;
  /** Items carried from the start; ids from `items`. */
  items?: string[];
  /** Starting counts of stacking items (`arrow: 12`); a count above 0 also puts the item in the inventory. */
  counts?: Record<string, number>;
  /** Items worn from the start (with `slots`); default: the first carried item of each slot. */
  equipped?: string[];
  /** Starting level (with `levels`; default 1). */
  level?: number;
  /** Starting values of resources, over their `initial` (a character sheet carries life, gold, experience). */
  resources?: Record<string, number>;
  /** Statuses it starts with: id → turns (0 = until cleared). */
  statuses?: Record<string, number>;
}

/** Levels (RPG PRD §4.4): the experience resource and the experience each level needs (`at[0]` for level 1). */
export interface LevelsDef {
  resource: string;
  at: number[];
}

/** Something the character can carry: an ink list item, so the story can `~ inv += knife` and `{inv ? knife: …}`. */
export interface ItemDef {
  /** Also the ink list item name, so it must be a valid ink identifier. */
  id: string;
  name?: LocalizedText;
  /** A line about it, shown with the name. */
  desc?: LocalizedText;
  /** Skill bonuses while carried (an item with a `slot`: while equipped); keys are skill ids. */
  modifiers?: Record<string, number>;
  /** Counted (RPG PRD §4.2): `give("arrow", 3)`, `take("arrow", 1)`, `inv_count("arrow")`; kept in `<id>_n`. */
  stack?: boolean;
  /** The slot it is worn in (an id from `slots`); its `modifiers` count only while it is equipped. */
  slot?: string;
}

/** An equipment slot (RPG PRD §4.2): one item of that slot is equipped at a time (`equip("sword")`). */
export interface SlotDef {
  id: string;
  name?: LocalizedText;
}

/** A status effect (RPG PRD §4.3): `add_status(who, "poison", 3)` on the character ("me"), a party member or an entity. */
export interface StatusDef {
  id: string;
  name?: LocalizedText;
  desc?: LocalizedText;
  /** Skill bonuses while the character itself has it; keys are skill ids. */
  modifiers?: Record<string, number>;
  /** `rest_statuses()` takes it off everyone. */
  rest?: boolean;
}

/** One row of a random table: the dice range it covers (`1-3`, `4`, `66`; none = one face per row) and its text. */
export interface TableRow {
  range?: string;
  text: LocalizedText;
  /** For stories that branch on the row: `table_id("encounter", total)`. */
  id?: string;
  /** A template (of any kind) this row spawns with `spawn_from("encounter")` (RPG PRD §4.1). */
  spawn?: string;
  /** How many it spawns: a number or a dice formula (`d3`, `d6+1`); default 1. */
  count?: number | string;
  /** Stats the spawned entities start with instead of the template's (only those given). */
  stats?: Record<string, number>;
}

/**
 * A random table the story rolls on with `{table("encounter")}`: rows written here, or read from
 * the first markdown table of another note (`from`, a path relative to the game's folder). The
 * dice are given (`dice: 2d6`) or inferred from the ranges (d66 when they read like it, else one
 * die as big as the top bound; one face per row when there are no ranges).
 */
export interface TableDef {
  /** Also the name the story passes: `table("encounter")`; a valid ink identifier. */
  id: string;
  name?: LocalizedText;
  dice?: string;
  rows?: TableRow[];
  from?: string;
  /** Offered on the player's dice tray (an inspiration table: "action × theme"). */
  oracle?: boolean;
}

/** A turn structure: the round counter and the phase variable (a string, one of the phases' ids), which the generated ink declares. */
export interface TurnDef {
  round: string;
  phase: string;
  phases: { id: string; name?: LocalizedText }[];
}

/** A record: a list of short entries kept in one ink string (`record_add("clues", "the old mill")`), with a counter. */
export interface RecordDef {
  /** Also the ink variable holding it; `<id>_count` (InkNames.countSuffix) counts its entries. */
  id: string;
  name?: LocalizedText;
  /** Like a resource's `when`: shown only while that story variable is true, non-zero or not empty. */
  when?: string;
}

/** A card: an item of its deck's LIST, so a hand is a list the story keeps (`~ hand += draw("clues")`). */
export interface CardDef {
  /** Also the ink list item name: a valid ink identifier, unique across the game. */
  id: string;
  name?: LocalizedText;
  desc?: LocalizedText;
  /** Card art: a vault path (or one relative to the game's folder). */
  image?: string;
  /** Numbers on the card (`cost: 2`, `icons: { combat: 1 }` flattened to `icons_combat`); the generated ink reads them with `card_<key>(card)`. */
  attrs?: Record<string, number>;
}

/**
 * A deck the story draws from without replacement: `draw("clues")` takes a random card out of the
 * pile (an empty list once it is empty), `shuffle("clues")` puts every card back, `deck_left("clues")`
 * counts the pile. The generated ink declares `LIST <id>` with the cards and `VAR <id>_pile`.
 */
export interface DeckDef {
  id: string;
  name?: LocalizedText;
  cards: CardDef[];
  /** A folder of notes, one card each (file name = id; frontmatter name, desc, image and numbers; body = desc), read in place of `cards`. */
  from?: string;
}

/**
 * A hand: a list variable of cards the panel shows as a row of cards (`VAR <id> = ()` is generated;
 * the story adds and removes: `~ hand += draw("clues")`). A choice tagged `#play:<id>` is taken with
 * one of its cards: the engine writes the card into the `played` VAR, the story reads it.
 */
export interface HandDef {
  id: string;
  name?: LocalizedText;
}

/** A place on the map: an item of the generated `LIST places`, drawn at (x, y) in the map's units. */
export interface PlaceDef {
  id: string;
  name?: LocalizedText;
  /** Position in map units; filled from the canvas when the map comes `from` one. */
  x: number;
  y: number;
  /** Neighbouring places, drawn as lines; the story decides where one can go. */
  links?: string[];
  /** Starts unrevealed (drawn as a question mark) until the story adds it to `revealed`. */
  hidden?: boolean;
  /** A story variable whose number is shown on the place (clues, doom). */
  counter?: string;
  counterName?: LocalizedText;
}

/** A token on the map: the generated `VAR <id>_at` holds its place (an empty list = off the map). */
export interface TokenDef {
  id: string;
  name?: LocalizedText;
  color?: string;
  /** Starting place. */
  at?: string;
}

/**
 * The stage: an image (optional) with named places the story moves the player (`VAR here`) and
 * tokens around on; places may start hidden and carry a counter. Coordinates are in `width` x
 * `height` units (the image's pixel size, or percentages when both are left out).
 */
export interface MapDef {
  /** A canvas file that gives the image, the places (text nodes; `?` first marks hidden) and the links (edges); `places` then only adds names and counters. */
  from?: string;
  /** Image path relative to the game's folder (or a vault path). */
  image?: string;
  width?: number;
  height?: number;
  places: PlaceDef[];
  tokens?: TokenDef[];
}

/** A number every party member has: `life_<member>` in ink. */
export interface PartyStatDef {
  id: string;
  name?: LocalizedText;
  /** Drawn as a bar up to this: a number, or the id of another stat that holds each member's maximum (`life_max`). */
  max?: number | string;
  /** Kept in ink but not shown (a maximum the bar reads, say). */
  hidden?: boolean;
}

/** One member of the party; the generated ink gives each stat, the member's title and gear its own VAR. */
export interface PartyMemberDef {
  /** Also the suffix of the member's variables (`life_<id>`), so it must be a valid ink identifier. */
  id: string;
  name?: LocalizedText;
  /** Starting stat values; keys are stat ids (missing ones start at 0). */
  stats?: Record<string, number>;
  /** Starting gear; ids from `items`. */
  items?: string[];
}

/** A template a kind's entities are spawned from: its name and starting stats (missing stats start at 0). */
export interface KindTemplate {
  id: string;
  name?: LocalizedText;
  stats?: Record<string, number>;
}

/**
 * A kind of dynamic entity (RPG PRD §4.1): monsters, summons, NPCs that come and go. Its entities live in one
 * string VAR named by the kind's id (`src/game/entities.ts`), numbered by `<id>_n` (InkNames.serialSuffix).
 */
export interface KindDef {
  /** Also the VAR holding the kind's entities, and the name the story passes: `spawn("foe", "goblin")`. */
  id: string;
  name?: LocalizedText;
  stats: PartyStatDef[];
  templates: KindTemplate[];
  /** A stat that lays an entity out (drawn faded) at 0 or less. */
  down?: string;
  /** A stat that takes an entity out of play when it is set to 0 or less (a monster killed). */
  remove?: string;
}

/**
 * Several characters played at once, shown as a row of cards: name, a title the story can set
 * (`~ title_m1 = "Cleric"`), stats (bars where they have a maximum) and gear (an items list per
 * member). The story owns every number; the panel only draws them.
 */
export interface PartyDef {
  name?: LocalizedText;
  stats: PartyStatDef[];
  members: PartyMemberDef[];
  /** A stat that lays a member out (drawn faded) when it is 0 or less, e.g. `life`. */
  down?: string;
  /** A stat that leaves a member out of the panel while it is 0 or less, e.g. a solo game's empty slots. */
  present?: string;
}

/** Where "write this session to a note" puts its note: a path with `{dir}`, `{story}`, `{date}`, `{time}`, `{character}`. */
export interface JournalConfig {
  path?: string;
  /** Write the run into the journal note as it is played (solo PRD §4.7), not only by the command. */
  live?: boolean;
}

/** The characters the player can pick. */
export function playableCharacters(config: GameConfig): CharacterDef[] {
  return config.characters.filter((c) => c.playable !== false);
}

/** Modifier rules read the story's state when a check is made. */
export type ModifierRule =
  | {
      kind: "perStep";
      /** For every `step` points of this variable, add `value` (e.g. fear: -1 per 25). */
      resource: string;
      step: number;
      value: number;
      /** Only for this skill; omitted = every skill. */
      skill?: string;
      label?: string;
    }
  | {
      kind: "when";
      variable: string;
      /** Apply when the variable equals this (default true). */
      equals?: string | number | boolean;
      value: number;
      skill?: string;
      label?: string;
    };

export interface GameConfig {
  rules: RulesConfig;
  /** Named difficulties usable in check tags, e.g. { 困难: 12 }. */
  difficulties?: Record<string, number>;
  skills: SkillDef[];
  /** Resources of the played character (fear, stamina, ...). */
  resources: ResourceDef[];
  /** Per-companion resources; variables are named `<resource>_<character>`. */
  companionResources?: ResourceDef[];
  characters: CharacterDef[];
  /** Things the character can carry; the generated ink declares them as a LIST and an inventory VAR. */
  items?: ItemDef[];
  /** Levels by experience: `level_up_ready()`, `level_up()`, `next_level_at()`. */
  levels?: LevelsDef;
  /** Where a character sheet is written (`#sheet` on a line; a folder relative to the game's), default `角色`/`Characters`. */
  sheets?: string;
  /** `characters: { from: folder }`: the characters are the sheets in that folder (relative to the game's), read by resolveConfig. */
  charactersFrom?: string;
  /** Equipment slots; an item names its slot (`slot: weapon`). */
  slots?: SlotDef[];
  /** Status effects the story puts on the character, party members and entities. */
  statuses?: StatusDef[];
  /** Several characters played at once: the panel shows a card per member. */
  party?: PartyDef;
  /** Kinds of dynamic entities (RPG PRD §4.1). */
  kinds?: KindDef[];
  /** Random tables the story rolls on (`{table("id")}`). */
  tables?: TableDef[];
  /** Decks the story draws from (`draw("id")`). */
  decks?: DeckDef[];
  /** Hands of cards the panel shows and the player plays from (`#play:<hand>`). */
  hands?: HandDef[];
  /** The map the panel draws: places, tokens, where the player is (`#go:<place>` on a choice). */
  map?: MapDef;
  /** A dungeon that grows while it is played: a sheet of squares and the room shapes the story hangs on its doors. */
  dungeon?: DungeonDef;
  /** Player-facing names of card attributes, by key (`cost: { zh: 费用, en: Cost }`); the key itself otherwise. */
  attributes?: Record<string, LocalizedText>;
  modifiers?: ModifierRule[];
  /** Where the play log is written as a note. */
  journal?: JournalConfig;
  /** The dice tray's oracle: thresholds and a chaos resource (solo PRD §4.3). */
  oracle?: OracleConfig;
  /** Records the story and the player keep: clues, people, threads (solo PRD §4.5). */
  records?: RecordDef[];
  /** Rounds and phases shown on the HUD (a board game's turn structure; the story moves them). */
  turn?: TurnDef;
  /**
   * Languages the story is written in, e.g. ["zh", "en"] (the first is the default). The
   * generated ink then declares the language variable and the text function (`{t("中文", "English")}`).
   */
  languages?: string[];
  /** File the generated ink is written to, next to the main story (default `_engine.ink`). */
  engineFile?: string;
  /**
   * Set by the loaders, not written in the note: the rule-system pack's `rules.ink` as the engine INCLUDEs it
   * (relative to the game's folder), when the game names a pack (`system:`) that has one (src/game/system.ts).
   */
  systemRules?: string;
  /** ink identifiers the generated code uses: a preset ("en" is the default, "zh" for Chinese names) or overrides. */
  ink?: InkPreset | Partial<InkNames>;
}

export type InkPreset = "en" | "zh";
export const DEFAULT_ENGINE_FILE = "_engine.ink";
/** A game folder holds its main story and one of these notes, whose frontmatter is the GameConfig. */
export const GAME_NOTE_NAMES = ["game.md", "游戏.md"];

export interface InkNames {
  /** EXTERNAL function the story calls to roll: `检定("技能名", 难度)` → band. */
  check: string;
  /** Generated function mapping a skill's name to its current level, for the ink fallback. */
  skillValue: string;
  /** LIST of playable characters. */
  characters: string;
  /** VAR holding the current character. */
  current: string;
  /** Function that loads a character's preset: `选主角(谁)`. */
  select: string;
  /** VARs the engine writes so the dice follow the state: the run's seed and how many checks it rolled. */
  seed: string;
  rolls: string;
  /** LIST of the items and the VAR holding what is carried. */
  items: string;
  inventory: string;
  /** VAR holding the story's language and the function picking text by it (bilingual stories). */
  langVar: string;
  textFn: string;
  /** EXTERNAL the engine rolls free dice through (`roll_dice(formula, label)`), and the story-facing `roll(formula)`. */
  dice: string;
  roll: string;
  /** Tables: `table(name)` rolls and reads a row; `table_roll(name)` the total; `table_text`/`table_id(name, total)` the lookups. */
  table: string;
  tableRoll: string;
  tableText: string;
  tableId: string;
  /** Decks: `draw(deck)`, `shuffle(deck)`, `deck_left(deck)`, the k-th-card helper, and the suffix of each deck's pile VAR. */
  draw: string;
  shuffle: string;
  deckLeft: string;
  nthCard: string;
  pileSuffix: string;
  /** VAR the engine writes the card chosen for a `#play` choice into, before the choice is taken. */
  played: string;
  /** Map: the LIST of places, the VAR holding where the player is, the VAR listing revealed places, the suffix of each token's place VAR. */
  places: string;
  here: string;
  revealed: string;
  atSuffix: string;
  /** Card attributes: `card_cost(which)` is generated per attribute key. */
  cardPrefix: string;
  cardParam: string;
  /** Growing dungeon: the VARs holding the layout string and the room the party is in. */
  dungeonVar: string;
  dungeonRoom: string;
  /** Pure EXTERNALs on a layout string (the engine binds them), and the story-facing wrappers that act on the layout VAR. */
  dungeonStart: string;
  dungeonAdd: string;
  dungeonRooms: string;
  dungeonDoors: string;
  dungeonMark: string;
  dungeonShape: string;
  dungeonCorridor: string;
  /** Secret door (`dungeon_secret(layout, shape, room)`), the way through the rooms (`dungeon_steps(layout, from, to)`), the nearest room with a free door (`dungeon_nearest(layout, from)`). */
  dungeonSecret: string;
  dungeonSteps: string;
  dungeonNearest: string;
  /** The k-th room walked into on the shortest way (`dungeon_via(layout, from, to, k)`, 0 past the end). */
  dungeonVia: string;
  /** Records (clues, people, threads): the wrappers `record_add/remove/count/pick/list(record, …)`, the pure EXTERNALs on a store, the counter suffix, and parameter names. */
  recordAdd: string;
  recordRemove: string;
  recordCount: string;
  recordPick: string;
  recordList: string;
  recordJoin: string;
  recordDrop: string;
  recordSize: string;
  recordAt: string;
  recordText: string;
  countSuffix: string;
  recordParam: string;
  entryParam: string;
  storeParam: string;
  recordNoParam: string;
  /** Temps in the generated functions: named here, reserved, so no card, item or place id can clash with them. */
  tempCard: string;
  tempBefore: string;
  /** Room notes: the VAR holding them, the pure EXTERNALs on it, and the wrappers `room_note(room, field)` / `set_room_note(room, field, value)`. */
  notesVar: string;
  noteGet: string;
  noteSet: string;
  roomNote: string;
  setRoomNote: string;
  notesParam: string;
  fieldParam: string;
  valueParam: string;
  kParam2: string;
  beginDungeon: string;
  addRoom: string;
  markRoom: string;
  /** Wrapper: `secret_room(shape, room)` hangs a room behind a new door on a wall of `room` and returns its number (0 when no wall has room behind it). */
  secretRoom: string;
  toParam: string;
  layoutParam: string;
  shapeParam: string;
  roomParam: string;
  doorParam: string;
  markParam: string;
  /** Entities (RPG PRD §4.1): the pure EXTERNALs on a kind's store, the wrappers taking ids and kinds as strings, the serial suffix and parameter and temp names. */
  entSpawn: string;
  entHas: string;
  entGet: string;
  entSet: string;
  entDrop: string;
  entCount: string;
  entAt: string;
  entPick: string;
  entName: string;
  spawn: string;
  stat: string;
  setStat: string;
  addStat: string;
  despawn: string;
  alive: string;
  pickOne: string;
  nthOne: string;
  nameOf: string;
  serialSuffix: string;
  kindParam: string;
  entityParam: string;
  statParam: string;
  amountParam: string;
  howParam: string;
  templateParam: string;
  entStoreParam: string;
  tempEntity: string;
  tempPickNo: string;
  /** Table rows that spawn: `spawn_from(table)` rolls and spawns, `spawn_row(table, total)` spawns a total's row; the rest are helpers. */
  /** The kind name the party answers to in `alive`, `pick_one` and `nth_one` (its standing members). */
  partyKind: string;
  spawnFrom: string;
  spawnRow: string;
  spawnRowOne: string;
  spawnTimes: string;
  tempRowNo: string;
  /** Party: prefixes of each member's title (text) and gear (an items list) VARs: `title_m1`, `gear_m1`. */
  partyTitle: string;
  partyGear: string;
  /**
   * Party reads done by the engine (RPG PRD §4.5): `member_get(who, "var")` reads `<var>_<member>` (who = number from 1
   * or id), `party_count("var", value)` counts the members whose variable equals the value. Much cheaper than an ink
   * switch per member; the ink fallback knows the party's own stats only.
   */
  memberGet: string;
  partyCount: string;
  memberParam: string;
  varNameParam: string;
  matchParam: string;
  tempMatches: string;
  /**
   * Stacking items, slots and statuses (RPG PRD §4.2–4.3): `give(item, n)`, `take(item, n)` (returns how many were
   * taken), `inv_count(item)`, counts in `<item><stackSuffix>`; `equip(item)`, `unequip(item)` on the `equipped` list;
   * the statuses VAR, the pure EXTERNALs on it and the wrappers taking who (an id, or `self` for the character).
   */
  /** Levels (RPG PRD §4.4): the level VAR and its functions. */
  level: string;
  levelUpReady: string;
  levelUp: string;
  nextLevelAt: string;
  give: string;
  take: string;
  invCount: string;
  stackSuffix: string;
  itemParam: string;
  tempTaken: string;
  equipped: string;
  equip: string;
  unequip: string;
  statusVar: string;
  self: string;
  addStatus: string;
  hasStatus: string;
  statusTurns: string;
  clearStatus: string;
  tickStatuses: string;
  restStatuses: string;
  stPut: string;
  stHas: string;
  stLeft: string;
  stTake: string;
  stTick: string;
  stRest: string;
  statusParam: string;
  turnsParam: string;
  statusStoreParam: string;
  /** Parameter names of the generated functions. */
  skillParam: string;
  difficultyParam: string;
  whoParam: string;
  formulaParam: string;
  labelParam: string;
  tableParam: string;
  totalParam: string;
  deckParam: string;
  stackParam: string;
  kParam: string;
}

export const INK_PRESETS: Record<InkPreset, InkNames> = {
  en: {
    check: "check", skillValue: "skill_level", characters: "characters", current: "character", select: "pick_character",
    seed: "dice_seed", rolls: "dice_rolls", items: "items", inventory: "inv", langVar: "lang", textFn: "t",
    dice: "roll_dice", roll: "roll", table: "table", tableRoll: "table_roll", tableText: "table_text", tableId: "table_id",
    draw: "draw", shuffle: "shuffle", deckLeft: "deck_left", nthCard: "nth_card", pileSuffix: "_pile", played: "played",
    places: "places", here: "here", revealed: "revealed", atSuffix: "_at", cardPrefix: "card_", cardParam: "which",
    dungeonVar: "dungeon", dungeonRoom: "room", dungeonStart: "dungeon_start", dungeonAdd: "dungeon_add", dungeonRooms: "dungeon_rooms", dungeonDoors: "dungeon_doors",
    dungeonMark: "dungeon_mark", dungeonShape: "dungeon_shape", dungeonCorridor: "dungeon_corridor", beginDungeon: "begin_dungeon", addRoom: "add_room", markRoom: "mark_room",
    dungeonSecret: "dungeon_secret", dungeonSteps: "dungeon_steps", dungeonNearest: "dungeon_nearest", secretRoom: "secret_room", toParam: "to_room",
    dungeonVia: "dungeon_via", notesVar: "room_notes", noteGet: "dungeon_note_get", noteSet: "dungeon_note_set", roomNote: "room_note", setRoomNote: "set_room_note",
    notesParam: "notes_text", fieldParam: "field", valueParam: "value", kParam2: "nth",
    layoutParam: "dungeon_text", shapeParam: "shape_id", roomParam: "room_no", doorParam: "door_no", markParam: "mark_text",
    partyTitle: "title", partyGear: "gear", memberGet: "member_get", partyCount: "party_count", memberParam: "member", varNameParam: "var_name", matchParam: "match", tempMatches: "matches",
    entSpawn: "ent_spawn", entHas: "ent_has", entGet: "ent_get", entSet: "ent_set", entDrop: "ent_drop", entCount: "ent_count", entAt: "ent_at", entPick: "ent_pick", entName: "ent_name",
    spawn: "spawn", stat: "stat", setStat: "set_stat", addStat: "add_stat", despawn: "despawn", alive: "alive", pickOne: "pick_one", nthOne: "nth_one", nameOf: "name_of",
    serialSuffix: "_n", kindParam: "kind", entityParam: "who_id", statParam: "stat_id", amountParam: "amount", howParam: "how", templateParam: "template", entStoreParam: "kind_store", tempEntity: "new_id", tempPickNo: "pick_no", partyKind: "party", spawnFrom: "spawn_from", spawnRow: "spawn_row", spawnRowOne: "spawn_row_one", spawnTimes: "spawn_times", tempRowNo: "row_no",
    recordAdd: "record_add", recordRemove: "record_remove", recordCount: "record_count", recordPick: "record_pick", recordList: "record_list",
    recordJoin: "record_join", recordDrop: "record_drop", recordSize: "record_size", recordAt: "record_at", recordText: "record_text",
    countSuffix: "_count", recordParam: "record_id", entryParam: "entry_text", storeParam: "record_store", recordNoParam: "record_no", tempCard: "drawn_card", tempBefore: "rooms_before",
    level: "level", levelUpReady: "level_up_ready", levelUp: "level_up", nextLevelAt: "next_level_at",
    give: "give", take: "take", invCount: "inv_count", stackSuffix: "_n", itemParam: "item_id", tempTaken: "taken",
    equipped: "equipped", equip: "equip", unequip: "unequip",
    statusVar: "statuses", self: "me", addStatus: "add_status", hasStatus: "has_status", statusTurns: "status_turns", clearStatus: "clear_status", tickStatuses: "tick_statuses", restStatuses: "rest_statuses",
    stPut: "status_put", stHas: "status_in", stLeft: "status_left", stTake: "status_take", stTick: "status_tick", stRest: "status_rest", statusParam: "status_id", turnsParam: "turns", statusStoreParam: "status_store",
    skillParam: "skill", difficultyParam: "difficulty", whoParam: "who", formulaParam: "formula", labelParam: "label", tableParam: "name", totalParam: "total",
    deckParam: "deck", stackParam: "stack", kParam: "k",
  },
  zh: {
    check: "检定", skillValue: "技能值", characters: "主角", current: "当前主角", select: "选主角",
    seed: "骰子种子", rolls: "掷骰次数", items: "物品", inventory: "背包", langVar: "语言", textFn: "双",
    dice: "掷骰", roll: "掷", table: "查表", tableRoll: "掷表", tableText: "表文", tableId: "表号",
    draw: "抽牌", shuffle: "洗牌", deckLeft: "剩余牌数", nthCard: "第几张", pileSuffix: "_牌堆", played: "出牌",
    places: "地点", here: "所在", revealed: "已揭示", atSuffix: "_在", cardPrefix: "牌_", cardParam: "哪张",
    dungeonVar: "地城", dungeonRoom: "所在房间", dungeonStart: "地城_起", dungeonAdd: "地城_接", dungeonRooms: "地城_房数", dungeonDoors: "地城_余门",
    dungeonMark: "地城_标记", dungeonShape: "地城_形状", dungeonCorridor: "地城_走廊", beginDungeon: "开地城", addRoom: "接房间", markRoom: "标记房间",
    dungeonSecret: "地城_暗门", dungeonSteps: "地城_步数", dungeonNearest: "地城_最近有门", secretRoom: "开暗门", toParam: "目标房间",
    dungeonVia: "地城_途经", notesVar: "房间记事", noteGet: "地城_取记事", noteSet: "地城_存记事", roomNote: "读房间记事", setRoomNote: "写房间记事",
    notesParam: "记事", fieldParam: "项", valueParam: "值", kParam2: "第几间",
    layoutParam: "布局", shapeParam: "形状", roomParam: "房间号", doorParam: "门号", markParam: "标记文字",
    partyTitle: "称号", partyGear: "装备", memberGet: "队员值", partyCount: "队员计数", memberParam: "队员", varNameParam: "变量名", matchParam: "等于", tempMatches: "符合的",
    entSpawn: "实体_生成", entHas: "实体_有", entGet: "实体_取", entSet: "实体_存", entDrop: "实体_去", entCount: "实体_数", entAt: "实体_第几", entPick: "实体_挑", entName: "实体_名",
    spawn: "生成", stat: "属性", setStat: "设属性", addStat: "加属性", despawn: "移除", alive: "剩几个", pickOne: "挑一个", nthOne: "第几个", nameOf: "名字",
    serialSuffix: "_号", kindParam: "种类", entityParam: "实体", statParam: "属性名", amountParam: "数值", howParam: "挑法", templateParam: "模板", entStoreParam: "种类存储", tempEntity: "新编号", tempPickNo: "抽到第几", partyKind: "小队", spawnFrom: "按表生成", spawnRow: "按行生成", spawnRowOne: "按行生成一个", spawnTimes: "生成几次", tempRowNo: "行号",
    recordAdd: "记录_加", recordRemove: "记录_删", recordCount: "记录_数", recordPick: "记录_抽", recordList: "记录_列",
    recordJoin: "记录_并", recordDrop: "记录_去", recordSize: "记录_长", recordAt: "记录_取", recordText: "记录_文",
    countSuffix: "_数", recordParam: "记录名", entryParam: "条目", storeParam: "存储", recordNoParam: "第几条", tempCard: "抽出的牌", tempBefore: "原房数",
    level: "等级", levelUpReady: "可以升级", levelUp: "升级", nextLevelAt: "下一级经验",
    give: "给", take: "拿走", invCount: "有几个", stackSuffix: "_数量", itemParam: "物品名", tempTaken: "拿走的",
    equipped: "装备着", equip: "装备上", unequip: "卸下",
    statusVar: "状态", self: "我", addStatus: "加状态", hasStatus: "有状态", statusTurns: "状态回合", clearStatus: "去状态", tickStatuses: "状态过回合", restStatuses: "休息去状态",
    stPut: "状态_放", stHas: "状态_有", stLeft: "状态_剩", stTake: "状态_取走", stTick: "状态_过", stRest: "状态_歇", statusParam: "状态名", turnsParam: "回合数", statusStoreParam: "状态存储",
    skillParam: "技能", difficultyParam: "难度", whoParam: "谁", formulaParam: "公式", labelParam: "标签", tableParam: "表名", totalParam: "点数",
    deckParam: "牌堆名", stackParam: "牌叠", kParam: "序号",
  },
};
export const DEFAULT_INK_NAMES: InkNames = INK_PRESETS.en;

export function inkNames(config: GameConfig): InkNames {
  return typeof config.ink === "string" ? INK_PRESETS[config.ink] : { ...DEFAULT_INK_NAMES, ...config.ink };
}

/** Where the generated ink lives, relative to the game's folder. */
export function engineFile(config: GameConfig): string {
  return config.engineFile ?? DEFAULT_ENGINE_FILE;
}

export interface CheckTag {
  skill: string;
  difficulty: number;
  /** One attempt only; a white (default) check can be retried once the state changes. */
  red: boolean;
}

const RED = new Set(["red", "红"]);

/** `check:<skill>:<difficulty>[:red]`; difficulty is a number or a name from config.difficulties. */
export function parseCheckTag(tag: string, config: GameConfig): CheckTag | null {
  const parts = tag.trim().split(":").map((p) => p.trim());
  if (parts[0] !== "check" || parts.length < 2 || parts.length > 4) return null;
  const [, skill, ...rest] = parts;
  if (!config.skills.some((s) => s.id === skill)) return null;
  const red = rest.length > 0 && RED.has(rest[rest.length - 1]);
  if (red) rest.pop();
  if (rest.length > 1) return null;
  // Roll-under systems ignore the difficulty, so their tags may leave it out (or write 0).
  const rollUnder = config.rules.kind === "rollUnder";
  if (rest.length === 0) return rollUnder ? { skill, difficulty: 0, red } : null;
  const diff = rest[0];
  const difficulty = /^\d+$/.test(diff)
    ? Number(diff)
    : Object.prototype.hasOwnProperty.call(config.difficulties ?? {}, diff) ? config.difficulties?.[diff] : undefined;
  if (difficulty === undefined || (difficulty <= 0 && !rollUnder)) return null;
  return { skill, difficulty, red };
}

/** `voice:<skill>` → the skill id. */
export function parseVoiceTag(tag: string, config: GameConfig): string | null {
  const parts = tag.trim().split(":").map((p) => p.trim());
  if (parts[0] !== "voice" || parts.length !== 2) return null;
  return config.skills.some((s) => s.id === parts[1]) ? parts[1] : null;
}

/** `needs:<item>` on a choice → the item id; the engine decides whether it is known and carried. */
export function parseNeedsTag(tag: string): string | null {
  const parts = tag.trim().split(":").map((p) => p.trim());
  if (parts[0] !== "needs" || parts.length !== 2 || parts[1] === "") return null;
  return parts[1];
}

/**
 * `play:<hand>` on a choice → the hand id and how many cards go (one); `play:<hand>:2` exactly two,
 * `play:<hand>:1-3` one to three. The engine decides whether the hand exists and holds enough.
 */
export function parsePlayTag(tag: string): { hand: string; min: number; max: number } | null {
  const parts = tag.trim().split(":").map((p) => p.trim());
  if (parts[0] !== "play" || parts[1] === undefined || parts[1] === "" || parts.length > 3) return null;
  if (parts.length === 2) return { hand: parts[1], min: 1, max: 1 };
  const m = /^(\d+)(?:-(\d+))?$/.exec(parts[2]);
  if (!m) return null;
  const min = Number(m[1]), max = m[2] === undefined ? min : Number(m[2]);
  return min >= 1 && max >= min ? { hand: parts[1], min, max } : null;
}

/** `use` on a choice: the player picks something carried (an item), written into the played VAR like a card. */
export function parseUseTag(tag: string): boolean {
  return tag.trim() === "use";
}

/** `go:<place>` on a choice → the place id; tapping that place on the map takes the choice. */
export function parseGoTag(tag: string): string | null {
  const parts = tag.trim().split(":").map((p) => p.trim());
  if (parts[0] !== "go" || parts.length !== 2 || parts[1] === "") return null;
  return parts[1];
}

/** Whether an inventory value read from the story (an ink list) holds the item. */
export function carries(inventory: unknown, id: string): boolean {
  const list = inventory as { ContainsItemNamed?: (name: string) => boolean } | null;
  return typeof list?.ContainsItemNamed === "function" && list.ContainsItemNamed(id);
}

/**
 * Screen effects a line can ask for with `#fx:<name>`: the panel and the web page play them when
 * the line first appears after a choice. A fixed vocabulary, not game data: shake the text,
 * a white flash, a moment of black, a red heartbeat.
 */
export const FX = ["shake", "flash", "dark", "pulse"] as const;
export type Fx = (typeof FX)[number];

/** `fx:shake` → "shake"; null for other tags and unknown effects. */
export function parseFxTag(tag: string): Fx | null {
  const parts = tag.trim().split(":").map((p) => p.trim());
  if (parts[0] !== "fx" || parts.length !== 2) return null;
  return (FX as readonly string[]).includes(parts[1]) ? (parts[1] as Fx) : null;
}

/** The effects asked for by a paragraph's tags, in order. */
export function fxOf(tags: string[]): Fx[] {
  return tags.map(parseFxTag).filter((f): f is Fx => f !== null);
}

/** Reads one story variable by name (e.g. `story.variablesState[name]`). */
export type StateReader = (name: string) => unknown;

/** Compares a story value with a rule's value by text, so bools, ints and strings from inkjs all match. */
function sameValue(actual: unknown, expected: string | number | boolean): boolean {
  // ink functions may hand back 1/0 for true/false.
  if (typeof expected === "boolean" && typeof actual === "number") return (actual !== 0) === expected;
  switch (typeof actual) {
    case "string": case "number": case "boolean": return String(actual) === String(expected);
    // Anything else (an ink list, an object) is compared by its own text form.
    case "object": return actual !== null && typeof (actual as { toString?: unknown }).toString === "function"
      && (actual as { toString: () => string }).toString() === String(expected);
    default: return false;
  }
}

/** Modifiers that apply to a check of `skill` given the current state: the rules, then the bonuses of carried items (named in `lang`). */
export function collectModifiers(config: GameConfig, skill: string, state: StateReader, lang = ""): Modifier[] {
  const out: Modifier[] = [];
  for (const rule of config.modifiers ?? []) {
    if (rule.skill !== undefined && rule.skill !== skill) continue;
    if (rule.kind === "perStep") {
      const v = Number(state(rule.resource) ?? 0);
      const steps = Math.floor(v / rule.step);
      if (steps > 0) out.push({ source: rule.label ?? rule.resource, value: rule.value * steps });
    } else if (sameValue(state(rule.variable), rule.equals ?? true)) {
      out.push({ source: rule.label ?? rule.variable, value: rule.value });
    }
  }
  const items = config.items ?? [];
  const n = inkNames(config);
  if (items.length > 0) {
    const inventory = state(n.inventory);
    // An item worn in a slot counts only while equipped (and carried); other items while carried.
    const equipped = config.slots?.length ? state(n.equipped) : null;
    for (const item of items) {
      const value = item.modifiers?.[skill];
      if (value === undefined || value === 0 || !carries(inventory, item.id)) continue;
      if (item.slot !== undefined && !carries(equipped, item.id)) continue;
      out.push({ source: localize(item.name, lang, item.id), value });
    }
  }
  if (config.statuses?.length) {
    const store = state(n.statusVar);
    const mine = statusEntries(typeof store === "string" ? store : "").filter((e) => e.who === n.self);
    for (const e of mine) {
      const def = config.statuses.find((d) => d.id === e.id);
      const value = def?.modifiers?.[skill];
      if (value !== undefined && value !== 0) out.push({ source: localize(def?.name, lang, e.id), value });
    }
  }
  return out;
}

/** ink identifiers: letters (any script), digits and underscores, not starting with a digit. */
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;
export const isIdent = (id: string): boolean => IDENT.test(id);

/** The numbers among an object's fields, nested objects flattened with `_` (`icons: { combat: 1 }` → `icons_combat`); other values are left out. */
export function numberFields(obj: Record<string, unknown>, skip: Iterable<string> = []): Record<string, number> {
  const out: Record<string, number> = {};
  const skipped = new Set(skip);
  const walk = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (prefix === "" && skipped.has(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) out[prefix + k] = v;
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v as Record<string, unknown>, `${prefix}${k}_`);
    }
  };
  walk(obj, "");
  return out;
}

/** A card entry as written (inline in the note or in a card note's frontmatter): id, name, desc, image and its numbers as attrs. */
export function readCard(c: Record<string, unknown>, id: string): CardDef {
  const card: CardDef = { id };
  if (isText(c.name)) card.name = c.name;
  if (isText(c.desc)) card.desc = c.desc;
  if (isStr(c.image)) card.image = c.image.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
  const attrs = numberFields(c, ["id", "name", "desc", "image"]);
  if (Object.keys(attrs).length > 0) card.attrs = attrs;
  return card;
}

export const CONFIG_PROBLEM_CODES = [
  "noFrontmatter", "rulesKind", "list", "shape", "dice", "sides", "ident", "duplicate", "noCharacters", "oracleChaos", "oracleOdds", "resourceTrack",
  "resourceRange", "difficulty", "unknownSkill", "skillLevel", "unknownCompanionResource", "modifierSkill", "modifierStep", "languages",
  "unknownItem", "itemSkill", "tableRows", "tableDice", "tableRange", "tableRow", "tableFile", "deckCards",
  "mapPlaces", "mapLink", "mapPlace", "mapFile", "mapCanvasPlace", "deckFolder", "cardAttr", "tokens",
  "dungeonSize", "dungeonShape", "dungeonFile", "partyStat", "kindStat", "rowSpawn", "systemMissing", "systemVersion",
  "itemSlot", "statusSkill", "countItem", "levelsResource", "levelsOrder", "characterResource", "characterStatus", "characterLevel", "charactersFolder",
] as const;
export type ConfigProblemCode = (typeof CONFIG_PROBLEM_CODES)[number];

/** A problem in a game config, as data; the panel words it in the user's language (`T().configProblem`). */
export interface ConfigProblem {
  code: ConfigProblemCode;
  /** What the message names: ids, paths, values. */
  args: string[];
}

/** Problems that would make the generated ink or the checks misbehave; empty when fine. */
export function validateConfig(config: GameConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const bad = (code: ConfigProblemCode, ...args: (string | number)[]) => problems.push({ code, args: args.map(String) });
  // The tray's oracle: a chaos value is one of the character's resources; a threshold leaves a chance either way.
  if (config.oracle?.chaos !== undefined && !config.resources.some((r) => r.id === config.oracle?.chaos)) bad("oracleChaos", config.oracle.chaos);
  for (const [k, n] of Object.entries(config.oracle?.odds ?? {})) if (typeof n === "number" && (n < 1 || n > 99)) bad("oracleOdds", k, n);
  // A track is boxes of four ticks: its span must be whole boxes.
  for (const r of config.resources) if (r.display === "track" && (r.max - r.min) % 4 !== 0) bad("resourceTrack", r.id, r.max - r.min);
  if (config.rules.kind === "sum") {
    if (config.rules.dice.length === 0 || config.rules.dice.some((d) => !Number.isInteger(d) || d < 2)) bad("dice");
  } else if (config.rules.kind === "rollUnder") {
    if (!Number.isInteger(config.rules.sides) || config.rules.sides < 2) bad("sides");
  } else {
    if (config.rules.tokens.length === 0) bad("tokens");
    // Token ids are not ink identifiers (a value's text is one), so they live in their own namespace;
    // two tokens with the same id would be told apart by neither the card nor the log.
    const ids = new Set<string>();
    for (const t of config.rules.tokens) {
      const id = tokenId(t);
      if (ids.has(id)) bad("duplicate", id);
      ids.add(id);
    }
  }
  const seen = new Set<string>();
  const ident = (id: string) => {
    if (!IDENT.test(id)) bad("ident", id);
    if (seen.has(id)) bad("duplicate", id);
    seen.add(id);
  };
  for (const s of config.skills) ident(s.id);
  for (const r of config.resources) ident(r.id);
  for (const c of config.characters) ident(c.id);
  for (const i of config.items ?? []) {
    ident(i.id);
    if (i.stack) ident(`${i.id}${inkNames(config).stackSuffix}`);
  }
  for (const t of config.tables ?? []) ident(t.id);
  for (const d of config.decks ?? []) {
    ident(d.id);
    ident(`${d.id}${inkNames(config).pileSuffix}`);
    for (const c of d.cards) {
      ident(c.id);
      for (const key of Object.keys(c.attrs ?? {})) if (!IDENT.test(key)) bad("cardAttr", c.id, key);
    }
    if (d.cards.length === 0 && d.from === undefined) bad("deckCards", d.id);
  }
  for (const h of config.hands ?? []) ident(h.id);
  for (const r of config.records ?? []) {
    ident(r.id);
    ident(`${r.id}${inkNames(config).countSuffix}`);
  }
  if (config.turn) {
    ident(config.turn.round);
    ident(config.turn.phase);
    if (config.turn.phases.length === 0) bad("list", "turn.phases");
    const phases = new Set<string>();
    for (const p of config.turn.phases) {
      // Written into the generated ink as a string: an identifier, so nothing in it can break the file.
      if (!IDENT.test(p.id)) bad("ident", p.id);
      if (phases.has(p.id)) bad("duplicate", p.id);
      phases.add(p.id);
    }
  }
  if (config.map) {
    // Links and token places are checked once the canvas has filled the places in (resolveMap validates again).
    const deferred = config.map.from !== undefined;
    const places = new Set(config.map.places.map((p) => p.id));
    if (config.map.places.length === 0 && !deferred) bad("mapPlaces");
    for (const p of config.map.places) {
      ident(p.id);
      if (!deferred) for (const l of p.links ?? []) if (!places.has(l)) bad("mapLink", p.id, l);
    }
    for (const t of config.map.tokens ?? []) {
      ident(t.id);
      ident(`${t.id}${inkNames(config).atSuffix}`);
      if (!deferred && t.at !== undefined && !places.has(t.at)) bad("mapPlace", t.id, t.at);
    }
  }
  if (config.dungeon) {
    const d = config.dungeon;
    // Shapes read from a note come later (resolveDungeon), which checks them then.
    if (!Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width < 3 || d.height < 3) bad("dungeonSize");
    const shapeIds = new Set<string>();
    for (const s of d.shapes) {
      if (shapeIds.has(s.id)) bad("duplicate", s.id);
      shapeIds.add(s.id);
      const why = shapeProblem(s);
      if (why) bad("dungeonShape", s.id, why);
    }
    if (d.shapes.length === 0 && d.from === undefined) bad("dungeonShape", "-", "no shapes");
    if (d.stretch !== undefined && (!Number.isInteger(d.stretch) || d.stretch < 0 || d.stretch > 9)) bad("dungeonShape", "stretch", String(d.stretch));
    if (d.passages !== undefined && typeof d.passages !== "boolean") bad("dungeonShape", "passages", String(d.passages));
  }
  if (config.party) {
    const p = config.party;
    const n = inkNames(config);
    const stats = new Set<string>();
    for (const st of p.stats) {
      if (!IDENT.test(st.id)) bad("ident", st.id);
      if (stats.has(st.id)) bad("duplicate", st.id);
      stats.add(st.id);
    }
    for (const st of p.stats) if (typeof st.max === "string" && !stats.has(st.max)) bad("partyStat", st.id, st.max);
    if (p.down !== undefined && !stats.has(p.down)) bad("partyStat", "down", p.down);
    if (p.present !== undefined && !stats.has(p.present)) bad("partyStat", "present", p.present);
    if (p.members.length === 0) bad("list", "party.members");
    const members = new Set<string>();
    const itemIds = new Set((config.items ?? []).map((i) => i.id));
    for (const m of p.members) {
      if (!IDENT.test(m.id)) bad("ident", m.id);
      if (members.has(m.id)) bad("duplicate", m.id);
      members.add(m.id);
      for (const st of p.stats) ident(`${st.id}_${m.id}`);
      ident(`${n.partyTitle}_${m.id}`);
      if (config.items?.length) ident(`${n.partyGear}_${m.id}`);
      for (const id of Object.keys(m.stats ?? {})) if (!stats.has(id)) bad("partyStat", m.id, id);
      for (const id of m.items ?? []) if (!itemIds.has(id)) bad("unknownItem", m.id, id);
    }
  }
  // Each template's kind's stats: a template belongs to one kind.
  const templates = new Map<string, Set<string>>();
  for (const k of config.kinds ?? []) {
    ident(k.id);
    ident(`${k.id}${inkNames(config).serialSuffix}`);
    const stats = new Set<string>();
    for (const st of k.stats) {
      if (!IDENT.test(st.id)) bad("ident", st.id);
      if (stats.has(st.id)) bad("duplicate", st.id);
      stats.add(st.id);
    }
    for (const st of k.stats) if (typeof st.max === "string" && !stats.has(st.max)) bad("kindStat", k.id, st.max);
    if (k.down !== undefined && !stats.has(k.down)) bad("kindStat", k.id, k.down);
    if (k.remove !== undefined && !stats.has(k.remove)) bad("kindStat", k.id, k.remove);
    if (k.templates.length === 0) bad("list", `kinds.${k.id}.templates`);
    for (const t of k.templates) {
      // Entity ids are a template id, `_` and a number: an identifier, so the store needs no escaping, and the
      // number after the last `_` is the serial, so two templates of a kind never make the same id. The id
      // functions take an id alone, so a template belongs to one kind (`templates` spans every kind).
      if (!IDENT.test(t.id)) bad("ident", t.id);
      if (templates.has(t.id)) bad("duplicate", t.id);
      templates.set(t.id, stats);
      for (const id of Object.keys(t.stats ?? {})) if (!stats.has(id)) bad("kindStat", t.id, id);
    }
  }
  // With kinds, party members answer the entity functions by id and the party by the kind name `party`:
  // a member id must not read like a spawned id (`<template>_<n>`), and no kind may take the party's name.
  if (config.kinds?.length && config.party) {
    const partyKind = inkNames(config).partyKind;
    if (config.kinds.some((k) => k.id === partyKind)) bad("duplicate", partyKind);
    for (const m of config.party.members) {
      const at = m.id.lastIndexOf("_");
      if (at > 0 && /^\d+$/.test(m.id.slice(at + 1)) && templates.has(m.id.slice(0, at))) bad("duplicate", m.id);
    }
  }
  // Table rows that spawn: a template some kind has, stats of that kind, a count that is a number or a formula.
  for (const t of config.tables ?? []) {
    (t.rows ?? []).forEach((r, i) => {
      if (r.spawn === undefined) return;
      const stats = templates.get(r.spawn);
      if (!stats) return bad("rowSpawn", t.id, i + 1, r.spawn);
      for (const id of Object.keys(r.stats ?? {})) if (!stats.has(id)) bad("kindStat", r.spawn, id);
      if (typeof r.count === "string" && !parseFormula(r.count)) bad("rowSpawn", t.id, i + 1, r.count);
    });
  }
  // Companion resources only exist as `<resource>_<character>` variables, so their ids may
  // repeat a resource id (fear for the player and for each companion); the generated names
  // are what must not collide.
  const companionIds = new Set<string>();
  for (const r of config.companionResources ?? []) {
    if (!IDENT.test(r.id)) bad("ident", r.id);
    if (companionIds.has(r.id)) bad("duplicate", r.id);
    companionIds.add(r.id);
  }
  for (const r of config.companionResources ?? []) {
    for (const c of config.characters) ident(`${r.id}_${c.id}`);
  }
  // Generated names are reserved only when they are generated: a game without a map may call a resource `here`.
  const partyNames = ["memberGet", "partyCount", "memberParam", "varNameParam", "matchParam", "tempMatches"];
  const dungeonNames = ["dungeonVar", "dungeonRoom", "dungeonStart", "dungeonAdd", "dungeonRooms", "dungeonDoors", "dungeonMark", "dungeonShape", "dungeonCorridor", "dungeonSecret", "dungeonSteps", "dungeonNearest", "dungeonVia", "notesVar", "noteGet", "noteSet", "roomNote", "setRoomNote", "notesParam", "fieldParam", "valueParam", "kParam2", "beginDungeon", "addRoom", "markRoom", "secretRoom", "toParam", "layoutParam", "shapeParam", "roomParam", "doorParam", "markParam"];
  // Temps of the deck and dungeon functions are reserved with those.
  const tempNames = [...(config.decks?.length ? [] : ["tempCard"]), ...(config.dungeon ? [] : ["tempBefore"])];
  const recordNames = ["recordAdd", "recordRemove", "recordCount", "recordPick", "recordList", "recordJoin", "recordDrop", "recordSize", "recordAt", "recordText", "recordParam", "entryParam", "storeParam", "recordNoParam"];
  const entityNames = ["entSpawn", "entHas", "entGet", "entSet", "entDrop", "entCount", "entAt", "entPick", "entName", "spawn", "stat", "setStat", "addStat", "despawn", "alive", "pickOne", "nthOne", "nameOf", "kindParam", "entityParam", "statParam", "amountParam", "howParam", "templateParam", "entStoreParam", "tempEntity", "tempPickNo", "spawnFrom", "spawnRow", "spawnRowOne", "spawnTimes", "tempRowNo"];
  const stackNames = ["give", "take", "invCount", "itemParam", "tempTaken"];
  const slotNames = ["equipped", "equip", "unequip"];
  const levelNames = ["level", "levelUpReady", "levelUp", "nextLevelAt"];
  const statusNames = ["statusVar", "addStatus", "hasStatus", "statusTurns", "clearStatus", "tickStatuses", "restStatuses", "stPut", "stHas", "stLeft", "stTake", "stTick", "stRest", "statusParam", "turnsParam", "statusStoreParam"];
  const unused = new Set(["partyKind", "pileSuffix", "atSuffix", "cardPrefix", "partyTitle", "partyGear", "countSuffix", "serialSuffix", "stackSuffix", "self",
    ...(config.items?.some((i) => i.stack) ? [] : stackNames), ...(config.levels ? [] : levelNames), ...(config.slots?.length ? [] : slotNames), ...(config.statuses?.length ? [] : statusNames), ...(config.kinds?.length ? [] : entityNames), ...(config.party?.members.length ? [] : partyNames), ...(config.map ? [] : ["places", "here", "revealed"]), ...(config.hands?.length || config.items?.length ? [] : ["played"]), ...(config.dungeon ? [] : dungeonNames), ...(config.records?.length ? [] : recordNames), ...tempNames]);
  // The stack functions share the entities' amount parameter.
  if (config.items?.some((i) => i.stack)) unused.delete("amountParam");
  for (const [key, n] of Object.entries(inkNames(config)) as [string, string][]) if (!unused.has(key)) ident(n);
  if (config.languages !== undefined && (config.languages.length !== 2 || config.languages[0] === config.languages[1] || !config.languages.every((l) => IDENT.test(l)))) {
    bad("languages");
  }
  // Characters read from a folder come in when the config is resolved; until then there are none to count.
  if (playableCharacters(config).length === 0 && config.charactersFrom === undefined) bad("noCharacters");
  if (config.levels) {
    if (!config.resources.some((r) => r.id === config.levels?.resource)) bad("levelsResource", config.levels.resource);
    if (config.levels.at.length === 0 || config.levels.at.some((v, i, a) => !Number.isFinite(v) || (i > 0 && v <= a[i - 1]))) bad("levelsOrder", config.levels.resource);
  }
  for (const r of [...config.resources, ...(config.companionResources ?? [])]) {
    if (!(r.min <= r.initial && r.initial <= r.max)) bad("resourceRange", r.id);
  }
  for (const [name, value] of Object.entries(config.difficulties ?? {})) {
    if (!Number.isInteger(value) || value <= 0) bad("difficulty", name);
  }
  const skills = new Map(config.skills.map((s) => [s.id, s]));
  const items = new Set((config.items ?? []).map((i) => i.id));
  for (const i of config.items ?? []) {
    for (const s of Object.keys(i.modifiers ?? {})) if (!skills.has(s)) bad("itemSkill", i.id, s);
    if (i.slot !== undefined && !config.slots?.some((sl) => sl.id === i.slot)) bad("itemSlot", i.id, i.slot);
  }
  const statusIds = new Set<string>();
  for (const st of config.statuses ?? []) {
    if (statusIds.has(st.id)) bad("duplicate", st.id);
    statusIds.add(st.id);
    for (const sk of Object.keys(st.modifiers ?? {})) if (!skills.has(sk)) bad("statusSkill", st.id, sk);
  }
  const slotIds = new Set<string>();
  for (const sl of config.slots ?? []) {
    if (slotIds.has(sl.id)) bad("duplicate", sl.id);
    slotIds.add(sl.id);
  }
  const stacks = new Set((config.items ?? []).filter((i) => i.stack).map((i) => i.id));
  for (const c of config.characters) {
    for (const id of c.items ?? []) if (!items.has(id)) bad("unknownItem", c.id, id);
    for (const id of Object.keys(c.counts ?? {})) if (!stacks.has(id)) bad("countItem", c.id, id);
    for (const id of c.equipped ?? []) if (!items.has(id)) bad("unknownItem", c.id, id);
    for (const id of Object.keys(c.resources ?? {})) if (!config.resources.some((r) => r.id === id)) bad("characterResource", c.id, id);
    for (const id of Object.keys(c.statuses ?? {})) if (!statusIds.has(id)) bad("characterStatus", c.id, id);
    if (c.level !== undefined && (!config.levels || !Number.isInteger(c.level) || c.level < 1 || c.level > config.levels.at.length)) bad("characterLevel", c.id, c.level);
    for (const [id, level] of Object.entries(c.skills)) {
      const s = skills.get(id);
      if (!s) bad("unknownSkill", c.id, id);
      else if (!Number.isInteger(level) || level < 0 || level > (s.max ?? 6)) bad("skillLevel", c.id, id, level, s.max ?? 6);
    }
    for (const id of Object.keys(c.companion ?? {})) {
      if (!config.companionResources?.some((r) => r.id === id)) bad("unknownCompanionResource", c.id, id);
    }
  }
  for (const m of config.modifiers ?? []) {
    if (m.skill !== undefined && !skills.has(m.skill)) bad("modifierSkill", m.skill);
    if (m.kind === "perStep" && !(m.step > 0)) bad("modifierStep", m.resource);
  }
  for (const t of config.tables ?? []) problems.push(...tableProblems(t));
  return problems;
}

export interface LoadedConfig {
  config: GameConfig | null;
  /** Why the config is unusable (config null) or questionable (config set, problems listed). */
  problems: ConfigProblem[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isScalar = (v: unknown): v is string | number | boolean => isStr(v) || isNum(v) || isBool(v);
const numMap = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every(isNum);
const strMap = (v: unknown): v is Record<string, string> => isObj(v) && Object.values(v).every(isStr);
const isText = (v: unknown): v is LocalizedText => isStr(v) || strMap(v);
const isPreset = (v: unknown): v is InkPreset => v === "en" || v === "zh";
/** Optional field: absent (or an empty YAML value, which parses as null) or of the right type. */
const opt = (v: unknown, check: (x: unknown) => boolean): boolean => v === undefined || v === null || check(v);

/**
 * Reads a GameConfig from parsed frontmatter (any JSON-like value). A wrong shape makes the
 * config unusable (null); a well-formed one still carries validateConfig's problems.
 */
export function readConfig(fm: unknown): LoadedConfig {
  if (!isObj(fm)) return { config: null, problems: [{ code: "noFrontmatter", args: [] }] };
  const problems: ConfigProblem[] = [];
  const shape = (path: string) => problems.push({ code: "shape", args: [path] });
  const rules = fm.rules;
  if (!isObj(rules) || (rules.kind !== "sum" && rules.kind !== "rollUnder" && rules.kind !== "bag")) {
    problems.push({ code: "rulesKind", args: [] });
  } else if (rules.kind === "bag") {
    const token = (t: unknown) => isObj(t) && opt(t.id, isStr) && opt(t.name, isText) && opt(t.value, isNum) && opt(t.count, isNum)
      && (t.auto === undefined || t.auto === "fail" || t.auto === "success") && (isNum(t.value) || t.auto !== undefined);
    if (!Array.isArray(rules.tokens) || !rules.tokens.every(token)) shape("rules.tokens");
    if (!opt(rules.partialBelow, isNum)) shape("rules.partialBelow");
  } else if (rules.kind === "sum") {
    if (!Array.isArray(rules.dice) || !rules.dice.every(isNum)) shape("rules.dice");
    if (!opt(rules.partialBelow, isNum)) shape("rules.partialBelow");
    if (!opt(rules.naturalCrits, isBool)) shape("rules.naturalCrits");
  } else {
    if (!isNum(rules.sides)) shape("rules.sides");
    if (!opt(rules.criticalDivisor, isNum)) shape("rules.criticalDivisor");
    if (!opt(rules.fumbleFrom, isNum)) shape("rules.fumbleFrom");
  }
  if (!opt(fm.difficulties, numMap)) shape("difficulties");
  if (!opt(fm.ink, (v) => isPreset(v) || strMap(v))) shape("ink");
  if (!opt(fm.languages, (v) => Array.isArray(v) && v.every(isStr))) shape("languages");
  if (!opt(fm.engineFile, (v) => isStr(v) && v.endsWith(".ink") && !v.includes("/"))) shape("engineFile");
  /** A list of entries with an id; `required` lists must be non-empty, optional ones may be absent. */
  const entries = (key: string, required: boolean, check: (e: Record<string, unknown>) => boolean) => {
    const v = fm[key];
    if (v === undefined || v === null) {
      if (required) problems.push({ code: "list", args: [key] });
      return;
    }
    if (!Array.isArray(v) || (required && v.length === 0)) {
      problems.push({ code: required ? "list" : "shape", args: [key] });
      return;
    }
    v.forEach((e: unknown, i) => {
      if (!isObj(e) || !isStr(e.id) || !check(e)) shape(`${key}[${i}]`);
    });
  };
  const resource = (e: Record<string, unknown>) => isNum(e.min) && isNum(e.max) && isNum(e.initial) && opt(e.name, isText)
    && opt(e.display, (v) => v === "bar" || v === "clock" || v === "track") && opt(e.manual, isBool) && opt(e.when, isStr);
  const voice = (v: unknown) => isObj(v) && opt(v.stance, isText) && opt(v.color, isStr);
  entries("skills", true, (e) => opt(e.name, isText) && opt(e.max, isNum) && opt(e.voice, voice));
  entries("resources", false, resource);
  entries("companionResources", false, resource);
  entries("items", false, (e) => opt(e.name, isText) && opt(e.desc, isText) && opt(e.modifiers, numMap) && opt(e.stack, isBool) && opt(e.slot, isStr));
  entries("slots", false, (e) => opt(e.name, isText));
  entries("statuses", false, (e) => opt(e.name, isText) && opt(e.desc, isText) && opt(e.modifiers, numMap) && opt(e.rest, isBool));
  // A row is `{ range?, text, id? }`, or the shorthand with the text under the language codes: `{ range: 1-3, zh: 狼, en: Wolf }`.
  const row = (r: unknown) => isObj(r) && opt(r.range, (v) => isStr(v) || isNum(v)) && opt(r.id, (v) => isStr(v) || isNum(v)) && (isText(r.text) || Object.keys(r).some((k) => k !== "range" && k !== "id" && isStr(r[k])));
  entries("tables", false, (e) => opt(e.name, isText) && opt(e.dice, (v) => isStr(v) || isNum(v)) && opt(e.from, isStr) && opt(e.rows, (v) => Array.isArray(v) && v.every(row)));
  const card = (c: unknown) => isObj(c) && isStr(c.id) && opt(c.name, isText) && opt(c.desc, isText) && opt(c.image, isStr);
  entries("decks", false, (e) => opt(e.name, isText) && (isStr(e.from) ? opt(e.cards, (v) => Array.isArray(v) && v.every(card)) : Array.isArray(e.cards) && e.cards.every(card)));
  if (!opt(fm.attributes, (v) => isObj(v) && Object.values(v).every(isText))) shape("attributes");
  entries("hands", false, (e) => opt(e.name, isText));
  entries("records", false, (e) => opt(e.name, isText) && opt(e.when, isStr));
  if (!opt(fm.turn, (v) => isObj(v) && isStr(v.round) && isStr(v.phase) && Array.isArray(v.phases) && v.phases.every((p: unknown) => isObj(p) && isStr(p.id) && opt(p.name, isText)))) shape("turn");
  // A map drawn from a canvas gets its positions there, so its places need only an id.
  const fromCanvas = isObj(fm.map) && isStr(fm.map.from);
  const place = (p: unknown) => isObj(p) && isStr(p.id) && (fromCanvas ? opt(p.x, isNum) && opt(p.y, isNum) : isNum(p.x) && isNum(p.y)) && opt(p.name, isText) && opt(p.links, (v) => Array.isArray(v) && v.every(isStr))
    && opt(p.hidden, isBool) && opt(p.counter, isStr) && opt(p.counterName, isText);
  const token = (t: unknown) => isObj(t) && isStr(t.id) && opt(t.name, isText) && opt(t.color, isStr) && opt(t.at, isStr);
  if (!opt(fm.map, (v) => isObj(v) && opt(v.from, isStr) && opt(v.image, isStr) && opt(v.width, isNum) && opt(v.height, isNum) && (fromCanvas ? opt(v.places, (w) => Array.isArray(w) && w.every(place)) : Array.isArray(v.places) && v.places.every(place)) && opt(v.tokens, (w) => Array.isArray(w) && w.every(token)))) shape("map");
  const shapeEntry = (e: unknown) => isObj(e) && isStr(e.id) && Array.isArray(e.cells) && e.cells.every(isStr) && opt(e.name, isText) && opt(e.doors, (v) => Array.isArray(v) && v.every(isStr))
    && opt(e.entry, isStr) && (e.kind === undefined || e.kind === "room" || e.kind === "corridor");
  if (!opt(fm.dungeon, (v) => isObj(v) && isNum(v.width) && isNum(v.height) && opt(v.from, isStr) && opt(v.stretch, isNum) && opt(v.passages, (w) => typeof w === "boolean") && opt(v.shapes, (w) => Array.isArray(w) && w.every(shapeEntry)))) shape("dungeon");
  const partyStat = (e: unknown) => isObj(e) && isStr(e.id) && opt(e.name, isText) && opt(e.max, (v) => isNum(v) || isStr(v)) && opt(e.hidden, isBool);
  const partyMember = (e: unknown) => isObj(e) && isStr(e.id) && opt(e.name, isText) && opt(e.stats, numMap) && opt(e.items, (v) => Array.isArray(v) && v.every(isStr));
  if (!opt(fm.party, (v) => isObj(v) && opt(v.name, isText) && Array.isArray(v.stats) && v.stats.every(partyStat) && Array.isArray(v.members) && v.members.every(partyMember) && opt(v.down, isStr) && opt(v.present, isStr))) shape("party");
  const template = (t: unknown) => isObj(t) && isStr(t.id) && opt(t.name, isText) && opt(t.stats, numMap);
  entries("kinds", false, (e) => opt(e.name, isText) && Array.isArray(e.stats) && e.stats.every(partyStat) && Array.isArray(e.templates) && e.templates.every(template) && opt(e.down, isStr) && opt(e.remove, isStr));
  if (!opt(fm.journal, (v) => isObj(v) && opt(v.path, isStr) && opt(v.live, isBool))) shape("journal");
  const oddsMap = (v: unknown) => isObj(v) && Object.entries(v).every(([k, n]) => (ODDS as readonly string[]).includes(k) && isNum(n));
  if (!opt(fm.oracle, (v) => isObj(v) && opt(v.odds, oddsMap) && opt(v.chaos, isStr) && opt(v.chaosStep, isNum))) shape("oracle");
  // `characters: { from: folder }` names a folder of character sheets, read when the config is resolved.
  const charactersFrom = isObj(fm.characters) && isStr(fm.characters.from) && fm.characters.from.trim() !== "" ? fm.characters.from.trim() : undefined;
  if (charactersFrom === undefined) entries("characters", true, isCharacter);
  if (fm.levels !== undefined && !(isObj(fm.levels) && isStr(fm.levels.resource) && Array.isArray(fm.levels.at) && fm.levels.at.every(isNum))) shape("levels");
  if (fm.sheets !== undefined && !isStr(fm.sheets)) shape("sheets");
  const mods = fm.modifiers;
  if (mods !== undefined && mods !== null) {
    if (!Array.isArray(mods)) shape("modifiers");
    else {
      mods.forEach((m: unknown, i) => {
        const ok = isObj(m) && isNum(m.value) && opt(m.skill, isStr) && opt(m.label, isStr)
          && (m.kind === "perStep" ? isStr(m.resource) && isNum(m.step) : m.kind === "when" && isStr(m.variable) && opt(m.equals, isScalar));
        if (!ok) shape(`modifiers[${i}]`);
      });
    }
  }
  if (problems.length > 0) return { config: null, problems };
  const config: GameConfig = {
    rules: rules as RulesConfig,
    difficulties: (fm.difficulties ?? undefined) as GameConfig["difficulties"],
    skills: fm.skills as SkillDef[],
    resources: (fm.resources ?? []) as ResourceDef[],
    companionResources: (fm.companionResources ?? []) as ResourceDef[],
    characters: charactersFrom === undefined ? (fm.characters as CharacterDef[]).map((c) => ({ ...c, skills: c.skills ?? {} })) : [],
    ...(charactersFrom !== undefined ? { charactersFrom } : {}),
    ...(isObj(fm.levels) ? { levels: { resource: String(fm.levels.resource), at: (fm.levels.at as number[]).slice() } } : {}),
    ...(isStr(fm.sheets) ? { sheets: fm.sheets } : {}),
    items: (fm.items ?? []) as ItemDef[],
    ...(Array.isArray(fm.slots) && fm.slots.length > 0 ? { slots: (fm.slots as Record<string, unknown>[]).map((e) => ({ id: String(e.id), ...(isText(e.name) ? { name: e.name } : {}) })) } : {}),
    ...(Array.isArray(fm.statuses) && fm.statuses.length > 0 ? { statuses: (fm.statuses as Record<string, unknown>[]).map((e): StatusDef => ({ id: String(e.id), ...(isText(e.name) ? { name: e.name } : {}), ...(isText(e.desc) ? { desc: e.desc } : {}), ...(numMap(e.modifiers) ? { modifiers: e.modifiers } : {}), ...(e.rest === true ? { rest: true } : {}) })) } : {}),
    tables: (Array.isArray(fm.tables) ? fm.tables : []).filter(isObj).map(readTable),
    decks: (Array.isArray(fm.decks) ? fm.decks : []).filter(isObj).map((d) => ({
      id: String(d.id), ...(isText(d.name) ? { name: d.name } : {}), ...(isStr(d.from) ? { from: d.from } : {}),
      cards: (Array.isArray(d.cards) ? d.cards : []).filter(isObj).map((c) => readCard(c, String(c.id))),
    })),
    hands: (fm.hands ?? []) as HandDef[],
    ...(isObj(fm.turn) ? { turn: { round: String(fm.turn.round), phase: String(fm.turn.phase), phases: (fm.turn.phases as Record<string, unknown>[]).map((p) => ({ id: String(p.id), ...(isText(p.name) ? { name: p.name } : {}) })) } } : {}),
    ...(Array.isArray(fm.records) && fm.records.length > 0 ? { records: (fm.records as Record<string, unknown>[]).map((e) => ({ id: String(e.id), ...(isText(e.name) ? { name: e.name } : {}), ...(isStr(e.when) ? { when: e.when } : {}) })) } : {}),
    map: isObj(fm.map) ? readMap(fm.map) : undefined,
    dungeon: isObj(fm.dungeon) ? readDungeon(fm.dungeon) : undefined,
    party: isObj(fm.party) ? readParty(fm.party) : undefined,
    ...(Array.isArray(fm.kinds) && fm.kinds.length > 0 ? { kinds: fm.kinds.filter(isObj).map(readKind) } : {}),
    attributes: isObj(fm.attributes) ? (fm.attributes as Record<string, LocalizedText>) : undefined,
    modifiers: (fm.modifiers ?? []) as ModifierRule[],
    journal: isObj(fm.journal) ? { ...(isStr(fm.journal.path) ? { path: fm.journal.path } : {}), ...(typeof fm.journal.live === "boolean" ? { live: fm.journal.live } : {}) } : undefined,
    oracle: isObj(fm.oracle) ? fm.oracle : undefined,
    languages: (fm.languages ?? undefined) as string[] | undefined,
    engineFile: (fm.engineFile ?? undefined) as string | undefined,
    ink: fm.ink ?? undefined,
  };
  return { config, problems: validateConfig(config) };
}

/** Whether a characters entry (in game.md or a character sheet's frontmatter) has the right shape. */
export function isCharacter(e: Record<string, unknown>): boolean {
  return opt(e.name, isText) && opt(e.skills, numMap) && opt(e.companion, numMap) && opt(e.playable, isBool) && opt(e.items, (v) => Array.isArray(v) && v.every(isStr))
    && opt(e.counts, numMap) && opt(e.equipped, (v) => Array.isArray(v) && v.every(isStr)) && opt(e.level, isNum) && opt(e.resources, numMap) && opt(e.statuses, numMap);
}

/** A string or a number from the frontmatter as text; undefined for anything else. */
const scalarText = (v: unknown): string | undefined => (isStr(v) ? v : isNum(v) ? String(v) : undefined);

/** The party entry from the frontmatter, field by field (the shape was checked already). */
function readParty(p: Record<string, unknown>): PartyDef {
  const stats = (p.stats as Record<string, unknown>[]).map((st): PartyStatDef => ({
    id: String(st.id), ...(isText(st.name) ? { name: st.name } : {}), ...(isNum(st.max) || isStr(st.max) ? { max: st.max } : {}), ...(st.hidden === true ? { hidden: true } : {}),
  }));
  const members = (p.members as Record<string, unknown>[]).map((m): PartyMemberDef => ({
    id: String(m.id), ...(isText(m.name) ? { name: m.name } : {}), ...(numMap(m.stats) ? { stats: m.stats } : {}), ...(Array.isArray(m.items) ? { items: m.items.filter(isStr) } : {}),
  }));
  return { ...(isText(p.name) ? { name: p.name } : {}), stats, members, ...(isStr(p.down) ? { down: p.down } : {}), ...(isStr(p.present) ? { present: p.present } : {}) };
}

/** A kind of entity from the frontmatter, field by field (the shape was checked already). */
function readKind(k: Record<string, unknown>): KindDef {
  const stats = (k.stats as Record<string, unknown>[]).map((st): PartyStatDef => ({
    id: String(st.id), ...(isText(st.name) ? { name: st.name } : {}), ...(isNum(st.max) || isStr(st.max) ? { max: st.max } : {}), ...(st.hidden === true ? { hidden: true } : {}),
  }));
  const templates = (k.templates as Record<string, unknown>[]).map((t): KindTemplate => ({
    id: String(t.id), ...(isText(t.name) ? { name: t.name } : {}), ...(numMap(t.stats) ? { stats: t.stats } : {}),
  }));
  return { id: String(k.id), ...(isText(k.name) ? { name: k.name } : {}), stats, templates, ...(isStr(k.down) ? { down: k.down } : {}), ...(isStr(k.remove) ? { remove: k.remove } : {}) };
}

/** The map entry from the frontmatter, field by field (the shape was checked already). */
function readMap(m: Record<string, unknown>): MapDef {
  const places = (Array.isArray(m.places) ? m.places : []).filter(isObj).map((p): PlaceDef => ({
    id: String(p.id), x: Number(p.x), y: Number(p.y),
    ...(isText(p.name) ? { name: p.name } : {}),
    ...(Array.isArray(p.links) ? { links: p.links.filter(isStr) } : {}),
    ...(p.hidden === true ? { hidden: true } : {}),
    ...(isStr(p.counter) ? { counter: p.counter } : {}),
    ...(isText(p.counterName) ? { counterName: p.counterName } : {}),
  }));
  const tokens = (Array.isArray(m.tokens) ? m.tokens : []).filter(isObj).map((t): TokenDef => ({
    id: String(t.id), ...(isText(t.name) ? { name: t.name } : {}), ...(isStr(t.color) ? { color: t.color } : {}), ...(isStr(t.at) ? { at: t.at } : {}),
  }));
  return {
    ...(isStr(m.from) ? { from: m.from } : {}), ...(isStr(m.image) ? { image: m.image } : {}),
    ...(isNum(m.width) ? { width: m.width } : {}), ...(isNum(m.height) ? { height: m.height } : {}),
    places, ...(tokens.length > 0 ? { tokens } : {}),
  };
}

/** The dungeon entry from the frontmatter (the shape was checked already). */
function readDungeon(d: Record<string, unknown>): DungeonDef {
  const shapes = (Array.isArray(d.shapes) ? d.shapes : []).filter(isObj).map((s): ShapeDef => ({
    id: String(s.id), cells: (s.cells as string[]).map(String),
    ...(isText(s.name) ? { name: s.name } : {}), ...(Array.isArray(s.doors) ? { doors: s.doors.filter(isStr) } : {}),
    ...(isStr(s.entry) ? { entry: s.entry } : {}), ...(s.kind === "room" || s.kind === "corridor" ? { kind: s.kind } : {}),
  }));
  return {
    width: Number(d.width), height: Number(d.height), shapes, ...(isStr(d.from) ? { from: d.from } : {}),
    ...(isNum(d.stretch) ? { stretch: Number(d.stretch) } : {}), ...(typeof d.passages === "boolean" ? { passages: d.passages } : {}),
  };
}

/** A table entry from the frontmatter, its rows normalized to `{ range?, text, id? }` (the shorthand's language keys become `text`). */
function readTable(e: Record<string, unknown>): TableDef {
  const t: TableDef = { id: scalarText(e.id) ?? "" };
  if (isText(e.name)) t.name = e.name;
  const dice = scalarText(e.dice);
  if (dice !== undefined) t.dice = dice;
  if (isStr(e.from)) t.from = e.from;
  if (e.oracle === true) t.oracle = true;
  if (Array.isArray(e.rows)) {
    t.rows = (e.rows as Record<string, unknown>[]).map((r) => {
      const own = new Set(["range", "id", "spawn", "count"]);
      const row: TableRow = { text: isText(r.text) ? r.text : Object.fromEntries(Object.entries(r).filter(([k, v]) => !own.has(k) && isStr(v))) as Record<string, string> };
      const range = scalarText(r.range);
      if (range !== undefined) row.range = range;
      const id = scalarText(r.id);
      if (id !== undefined) row.id = id;
      const spawn = scalarText(r.spawn);
      if (spawn !== undefined) row.spawn = spawn;
      if (isNum(r.count)) row.count = Number(r.count);
      else if (isStr(r.count)) row.count = r.count;
      if (isObj(r.stats)) row.stats = Object.fromEntries(Object.entries(r.stats).filter(([, v]) => isNum(v)).map(([k, v]) => [k, Number(v)]));
      return row;
    });
  }
  return t;
}
