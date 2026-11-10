import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { PlaySession } from "../src/play/session";
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
        { id: "goblin1", template: "goblin", name: "Goblin 1", stats: [{ id: "life", name: "Life", value: 2, max: 2 }, { id: "attack", name: "Attack", value: 1 }], down: false },
        { id: "goblin2", template: "goblin", name: "Goblin 2", stats: [{ id: "life", name: "Life", value: 2, max: 2 }, { id: "attack", name: "Attack", value: 1 }], down: false },
        { id: "orc3", template: "orc", name: "Orc", stats: [{ id: "life", name: "Life", value: 4, max: 4 }, { id: "attack", name: "Attack", value: 2 }], down: false },
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
    expect(engine.hud().kinds?.[0].entities.map((e) => [e.id, e.stats[0].value])).toEqual([["orc3", 2]]);
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
    expect(a.text).toMatch(/^Picked (goblin1|orc2|goblin3)\.$/);
    expect(pick().text).toBe(a.text);
    expect(a.roll).toMatchObject({ kind: "dice", formula: "1d3" });
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
