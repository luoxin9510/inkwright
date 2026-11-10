import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { PlaySession } from "../src/play/session";
import { simulateStory } from "../src/play/simulate";
import { CONFIG } from "./fixtures/gameConfig";

const FM = {
  rules: { kind: "sum", dice: [6, 6] },
  skills: [{ id: "might" }],
  characters: [{ id: "you", skills: { might: 1 } }],
  kinds: [{
    id: "foe",
    name: { zh: "敌人", en: "Foes" },
    stats: [{ id: "life", name: { zh: "生命", en: "Life" }, max: "life_max" }, { id: "life_max", hidden: true }, { id: "attack", name: { zh: "攻击", en: "Attack" } }],
    templates: [
      { id: "goblin", name: { zh: "哥布林", en: "Goblin" }, stats: { life: 2, life_max: 2, attack: 1 } },
      { id: "orc", name: { zh: "兽人", en: "Orc" }, stats: { life: 4, life_max: 4, attack: 2 } },
    ],
    remove: "life",
  }],
};
const GAME = readConfig(FM).config as GameConfig;

const STORY = `-> start
${generateInk(GAME)}
=== start ===
~ temp a = spawn("foe", "goblin")
~ temp b = spawn("foe", "goblin")
~ temp c = spawn("foe", "orc")
{alive("foe")} foes: {name_of(a)}, {name_of(b)}, {name_of(c)}.
-> fight
=== fight ===
{ alive("foe") == 0: -> won }
~ temp t = pick_one("foe", "lowest:life")
+ [Hit {name_of(t)}]
    ~ add_stat(t, "life", -2)
    -> fight
+ [Run]
    You run.
    -> END
=== won ===
All gone.
-> END
`;

const RANDOM = `-> start
${generateInk(GAME)}
=== start ===
~ spawn("foe", "goblin")
~ spawn("foe", "orc")
~ spawn("foe", "goblin")
~ temp t = pick_one("foe", "random")
Picked {t}.
-> END
`;

const play = (src: string, engine: GameEngine | null) => new PlaySession(new Compiler(src).Compile(), engine ? { setup: (s) => engine.setup(s, "you"), prepare: (s) => engine.seed(s, 7) } : {});

describe("entities", () => {
  test("kinds read and validate; unknown stats and templates without a store id are reported", () => {
    const read = readConfig(FM);
    expect(read.problems).toEqual([]);
    expect(GAME.kinds?.[0].templates.map((t) => t.id)).toEqual(["goblin", "orc"]);
    expect(readConfig({ ...FM, kinds: [{ id: "foe", stats: "life", templates: [] }] }).problems).toEqual([{ code: "shape", args: ["kinds[0]"] }]);
    const bad = { ...GAME, kinds: [{ id: "foe", stats: [{ id: "life", max: "top" }], templates: [{ id: "rat", stats: { claws: 1 } }, { id: "rat" }], remove: "hp", down: "x" }] };
    expect(validateConfig(bad)).toEqual([
      { code: "kindStat", args: ["foe", "top"] },
      { code: "kindStat", args: ["foe", "x"] },
      { code: "kindStat", args: ["foe", "hp"] },
      { code: "kindStat", args: ["rat", "claws"] },
      { code: "duplicate", args: ["rat"] },
    ]);
    expect(validateConfig({ ...bad, kinds: [{ ...bad.kinds[0], templates: [] }] })).toContainEqual({ code: "list", args: ["kinds.foe.templates"] });
    // The kind's store and serial VARs share the game's namespace.
    expect(validateConfig({ ...GAME, resources: [{ id: "foe_n", min: 0, max: 9, initial: 0 }] })).toContainEqual({ code: "duplicate", args: ["foe_n"] });
    // Entity functions are reserved only when there are kinds: a game without them may name a resource `stat`.
    expect(validateConfig({ ...GAME, kinds: undefined, resources: [{ id: "stat", min: 0, max: 9, initial: 0 }] })).toEqual([]);
    expect(validateConfig({ ...GAME, resources: [{ id: "stat", min: 0, max: 9, initial: 0 }] })).toContainEqual({ code: "duplicate", args: ["stat"] });
  });

  test("with the engine: spawned, named, picked by a stat, hit until gone; the HUD lists them", () => {
    const engine = new GameEngine(GAME);
    engine.language = "en";
    const s = play(STORY, engine);
    let step = s.start();
    expect(s.log.map((p) => p.text)).toEqual(["3 foes: Goblin 1, Goblin 2, Orc."]);
    expect(step.choices.map((c) => c.text)).toEqual(["Hit Goblin 1", "Run"]);
    expect(engine.hud().kinds).toEqual([{
      id: "foe", name: "Foes", entities: [
        { id: "goblin_1", template: "goblin", name: "Goblin 1", stats: [{ id: "life", name: "Life", value: 2, max: 2 }, { id: "attack", name: "Attack", value: 1 }], down: false },
        { id: "goblin_2", template: "goblin", name: "Goblin 2", stats: [{ id: "life", name: "Life", value: 2, max: 2 }, { id: "attack", name: "Attack", value: 1 }], down: false },
        { id: "orc_3", template: "orc", name: "Orc", stats: [{ id: "life", name: "Life", value: 4, max: 4 }, { id: "attack", name: "Attack", value: 2 }], down: false },
      ],
    }]);
    step = s.choose(0);
    // The first goblin is gone; the one left is no longer numbered.
    expect(step.choices[0].text).toBe("Hit Goblin");
    for (let i = 0; i < 3; i++) step = s.choose(0);
    expect(s.log.at(-1)?.text).toBe("All gone.");
    expect(engine.hud().kinds?.[0].entities).toEqual([]);
    // Back puts the last one back, with the life it had.
    s.undo();
    expect(engine.hud().kinds?.[0].entities.map((e) => [e.id, e.stats[0].value])).toEqual([["orc_3", 2]]);
  });

  test("without the engine the story still compiles and runs: nothing is spawned", () => {
    const s = play(STORY, null);
    s.start();
    expect(s.log.map((p) => p.text)).toEqual(["0 foes: , , .", "All gone."]);
  });

  test("a random pick rolls on the run's dice: the same seed picks the same one, and the roll is logged", () => {
    const pick = () => {
      const engine = new GameEngine(GAME);
      const s = play(RANDOM, engine);
      s.start();
      return { text: s.log[0].text, roll: engine.rolls.at(-1) };
    };
    const a = pick();
    expect(a.text).toMatch(/^Picked (goblin_1|orc_2|goblin_3)\.$/);
    expect(pick().text).toBe(a.text);
    expect(a.roll).toMatchObject({ kind: "dice", formula: "1d3" });
  });

  test("entity ids never collide: a separator before the serial, template ids unique across kinds", () => {
    // Two kinds may not share a template: the id functions take an id alone.
    const twice = { ...GAME, kinds: [GAME.kinds![0], { id: "ally", stats: [{ id: "life" }], templates: [{ id: "goblin" }] }] };
    expect(validateConfig(twice)).toContainEqual({ code: "duplicate", args: ["goblin"] });
    // `goblin` + 11 and `goblin1` + 1 were the same id before the separator.
    const near = readConfig({ ...FM, kinds: [{ ...FM.kinds[0], templates: [{ id: "goblin", stats: { life: 1 } }, { id: "goblin1", stats: { life: 1 } }] }] }).config as GameConfig;
    expect(validateConfig(near)).toEqual([]);
    const src = `-> start
${generateInk(near)}
=== start ===
~ temp a = spawn("foe", "goblin1")
~ temp i = 0
~ temp last = ""
- (loop)
~ i += 1
~ last = spawn("foe", "goblin")
{ i < 10: -> loop }
{alive("foe")} {a} {last}
-> END
`;
    const s = play(src, new GameEngine(near));
    s.start();
    expect(s.log.at(-1)?.text).toBe("11 goblin1_1 goblin_11");
  });

  test("random runs count each kind: spawned and removed per template, choices alive, most at once, stats over their max", () => {
    const story = new Compiler(STORY).Compile();
    const x = simulateStory(story, { game: GAME, runs: 30, seed: 4 });
    const foe = x.kinds?.[0];
    expect(foe).toMatchObject({ kind: "foe", name: "敌人", overMax: 0 });
    const [goblin, orc] = foe!.templates;
    expect([goblin.template, goblin.spawned, orc.template, orc.spawned]).toEqual(["goblin", 60, "orc", 30]);
    for (const t of [goblin, orc]) expect(t.removed + t.left).toBe(t.spawned);
    // Some runs fight it out, some run away at once.
    expect(goblin.removed).toBeGreaterThan(0);
    expect(goblin.left).toBeGreaterThan(0);
    expect(goblin.turns).toBeGreaterThanOrEqual(1);
    expect(foe!.most).toEqual({ min: 3, mean: 3, max: 3 });
    // A stat pushed past its max is counted once per entity and stat.
    const over = new Compiler(`-> start\n${generateInk(GAME)}\n=== start ===\n~ temp g = spawn("foe", "goblin")\n~ set_stat(g, "life", 5)\nOver.\n-> END\n`).Compile();
    expect(simulateStory(over, { game: GAME, runs: 3 }).kinds?.[0].overMax).toBe(3);
  });

  test("a table row spawns: spawn_from rolls the table, spawns the row's template count times with its stats, returns the total", () => {
    const fm = {
      ...FM,
      tables: [{ id: "lair", dice: "d6", rows: [
        { range: "1-2", text: "nothing" },
        { range: "3-4", text: "goblins", spawn: "goblin", count: "d3" },
        { range: "5-6", text: "a big orc", spawn: "orc", stats: { life: 6, life_max: 6 } },
      ] }],
    };
    const read = readConfig(fm);
    expect(read.problems).toEqual([]);
    const game = read.config as GameConfig;
    expect(game.tables?.[0].rows?.[1]).toEqual({ range: "3-4", text: "goblins", spawn: "goblin", count: "d3" });
    expect(validateConfig(game)).toEqual([]);
    const src = `-> start
${generateInk(game)}
=== start ===
~ temp r = spawn_from("lair")
{r}: {table_text("lair", r)}, {alive("foe")} in play.
-> END
`;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const engine = new GameEngine(game);
      engine.language = "en";
      const s = new PlaySession(new Compiler(src).Compile(), { setup: (st) => engine.setup(st, "you"), prepare: (st) => engine.seed(st, seed) });
      s.start();
      const line = s.log[0].text;
      const [, total, , count] = /^(\d): (.+), (\d) in play\.$/.exec(line) ?? [];
      const r = Number(total);
      const kinds = engine.hud().kinds?.[0].entities ?? [];
      expect(kinds.length).toBe(Number(count));
      if (r <= 2) expect(kinds).toEqual([]);
      else if (r <= 4) {
        expect(kinds.length).toBeGreaterThanOrEqual(1);
        expect(kinds.length).toBeLessThanOrEqual(3);
        expect(kinds.every((e) => e.template === "goblin")).toBe(true);
      } else expect(kinds.map((e) => [e.template, e.stats[0].value, e.stats[0].max])).toEqual([["orc", 6, 6]]);
      seen.add(r <= 2 ? "none" : r <= 4 ? "goblins" : "orc");
    }
    expect(seen.size).toBe(3);
    // Without the engine nothing spawns, and the story still runs.
    const bare = new PlaySession(new Compiler(src).Compile(), {});
    bare.start();
    expect(bare.log[0].text).toMatch(/0 in play\.$/);
    // A row names a template no kind has, a stat its kind lacks, or a count that is not a number or a formula.
    const bad = { ...game, tables: [{ id: "lair", rows: [{ text: "x", spawn: "dragon" }, { text: "y", spawn: "goblin", stats: { wings: 2 } }, { text: "z", spawn: "orc", count: "lots" }] }] };
    expect(validateConfig(bad)).toEqual([
      { code: "rowSpawn", args: ["lair", "1", "dragon"] },
      { code: "kindStat", args: ["goblin", "wings"] },
      { code: "rowSpawn", args: ["lair", "3", "lots"] },
    ]);
  });

  test("party members answer the entity functions; the party is a kind of the standing members", () => {
    const fm = {
      ...FM,
      party: {
        stats: [{ id: "life", name: { en: "Life" }, max: "life_max" }, { id: "life_max", hidden: true }, { id: "here" }],
        members: [
          { id: "m1", name: { zh: "铁匠", en: "Smith" }, stats: { life: 3, life_max: 5, here: 1 } },
          { id: "m2", name: { zh: "巫师", en: "Wizard" }, stats: { life: 0, life_max: 3, here: 1 } },
          { id: "m3", name: { zh: "盗贼", en: "Rogue" }, stats: { life: 2, life_max: 4, here: 1 } },
          { id: "m4", name: { zh: "空位", en: "Empty" }, stats: { life: 1, here: 0 } },
        ],
        down: "life",
        present: "here",
      },
    };
    const game = readConfig(fm).config as GameConfig;
    expect(validateConfig(game)).toEqual([]);
    const src = `-> start
${generateInk(game)}
=== start ===
{alive("party")} up; weakest {pick_one("party", "lowest:life")}, strongest {pick_one("party", "highest:life_max")}; second {nth_one("party", 2)}; {name_of("m3")} has {stat("m3", "life")}/{stat("m3", "life_max")}.
~ add_stat("m1", "life", -1)
~ set_stat("m2", "life", 2)
{stat("m1", "life")} {alive("party")} {pick_one("party", "first")} {pick_one("party", "last")} {nth_one("party", 4)}.
~ despawn("m3")
{alive("party")} {stat("m3", "here")} {stat("nobody", "life")}.
~ temp r = pick_one("party", "random")
{r == "m1" or r == "m2": random ok}
-> END
`;
    // Plain ink: the same without the engine.
    for (const engine of [new GameEngine(game), null]) {
      if (engine) engine.language = "en";
      const s = new PlaySession(new Compiler(src).Compile(), engine ? { setup: (st) => engine.setup(st, "you"), prepare: (st) => engine.seed(st, 3) } : {});
      s.start();
      expect(s.log.map((p) => p.text)).toEqual([
        "2 up; weakest m3, strongest m1; second m3; 盗贼 has 2/4.",
        "2 3 m1 m3 .",
        "2 0 0.",
        "random ok",
      ]);
    }
    // A member id that reads like an entity id, or a kind named like the party, would be ambiguous.
    expect(validateConfig({ ...game, party: { ...game.party!, members: [{ id: "goblin_1" }] } })).toContainEqual({ code: "duplicate", args: ["goblin_1"] });
    expect(validateConfig({ ...game, kinds: [{ ...game.kinds![0], id: "party" }] })).toContainEqual({ code: "duplicate", args: ["party"] });
  });

  test("the zh ink names", () => {
    const zh = { ...GAME, ink: "zh" as const };
    expect(validateConfig(zh)).toEqual([]);
    const ink = generateInk(zh);
    for (const name of ["=== function 生成(种类, 模板) ===", "=== function 属性(实体, 属性名) ===", "VAR foe_号 = 0", "=== function 挑一个(种类, 挑法) ==="]) expect(ink).toContain(name);
    // The default test config (zh ink, no kinds) is untouched.
    expect(generateInk(CONFIG)).not.toContain("实体_生成");
  });
});
