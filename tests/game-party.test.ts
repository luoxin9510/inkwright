import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { readConfig, validateConfig, type GameConfig, type PartyDef } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

const PARTY: PartyDef = {
  name: { zh: "小队", en: "Party" },
  stats: [
    { id: "生命", name: { zh: "生命", en: "Life" }, max: "生命上限" },
    { id: "生命上限", hidden: true },
    { id: "等级", name: { zh: "等级", en: "Level" } },
  ],
  down: "生命",
  members: [
    { id: "甲", name: { zh: "战士", en: "Warrior" }, stats: { 生命: 7, 生命上限: 7, 等级: 1 }, items: ["刀"] },
    { id: "乙", name: { zh: "法师", en: "Wizard" }, stats: { 生命: 3, 生命上限: 3, 等级: 1 } },
  ],
};
const GAME: GameConfig = { ...CONFIG, party: PARTY };

const STORY = `-> main
${generateInk(GAME)}
=== main ===
{生命_甲}/{生命上限_甲},{装备_甲}。
+ [挨一刀]
    ~ 生命_乙 = 0
    ~ 称号_甲 = "老兵"
    ~ 装备_乙 += 手机
    ~ 等级_甲 += 1
    倒了一个。
    -> END
`;

describe("the party", () => {
  test("the config reads and validates; unknown stats, items and clashing names are reported", () => {
    const fm = { rules: { kind: "sum", dice: [6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], party: { stats: [{ id: "life", max: 5 }], members: [{ id: "a", stats: { life: 5 } }] } };
    const ok = readConfig(fm);
    expect(ok.problems).toEqual([]);
    expect(ok.config?.party).toEqual({ stats: [{ id: "life", max: 5 }], members: [{ id: "a", stats: { life: 5 } }] });
    expect(readConfig({ ...fm, party: { stats: "life", members: [] } }).problems).toEqual([{ code: "shape", args: ["party"] }]);
    const bad: PartyDef = { stats: [{ id: "生命", max: "上限" }], down: "命", members: [{ id: "甲", stats: { 体力: 1 }, items: ["锤"] }, { id: "甲" }] };
    expect(validateConfig({ ...CONFIG, party: bad })).toEqual([
      { code: "partyStat", args: ["生命", "上限"] },
      { code: "partyStat", args: ["down", "命"] },
      { code: "partyStat", args: ["甲", "体力"] },
      { code: "unknownItem", args: ["甲", "锤"] },
      { code: "duplicate", args: ["甲"] },
      { code: "duplicate", args: ["生命_甲"] },
      { code: "duplicate", args: ["称号_甲"] },
      { code: "duplicate", args: ["装备_甲"] },
    ]);
    // A member's variable must not collide with the game's own names.
    expect(validateConfig({ ...GAME, resources: [...CONFIG.resources, { id: "等级_乙", min: 0, max: 9, initial: 0 }] })).toContainEqual({ code: "duplicate", args: ["等级_乙"] });
  });

  test("the generated ink declares each member's stats, title and gear", () => {
    const ink = generateInk(GAME);
    for (const line of ["VAR 生命_甲 = 7", "VAR 生命上限_甲 = 7", "VAR 等级_甲 = 1", 'VAR 称号_甲 = ""', "VAR 装备_甲 = (刀)", "VAR 生命_乙 = 3", "VAR 装备_乙 = ()"]) expect(ink).toContain(line);
    // Without items there is no gear.
    expect(generateInk({ ...GAME, items: [] })).not.toContain("装备_甲");
  });

  test("the panel reads the members from the story: bars, titles, gear, who is down", () => {
    const engine = new GameEngine(GAME);
    engine.language = "zh";
    const session = new PlaySession(new Compiler(STORY).Compile(), { setup: (s) => engine.setup(s, "昕") });
    expect(session.start().paragraphs[0].text).toBe("7/7,刀。");
    expect(engine.hud().party).toEqual({
      name: "小队",
      members: [
        { id: "甲", name: "战士", title: "", stats: [{ id: "生命", name: "生命", value: 7, max: 7 }, { id: "等级", name: "等级", value: 1 }], gear: [{ id: "刀", name: "刀", desc: "衣柜最里面的那把。" }], down: false },
        { id: "乙", name: "法师", title: "", stats: [{ id: "生命", name: "生命", value: 3, max: 3 }, { id: "等级", name: "等级", value: 1 }], gear: [], down: false },
      ],
    });
    session.choose(0);
    const [a, b] = engine.hud().party!.members;
    expect([a.title, a.stats[1].value, b.down, b.gear?.map((g) => g.id)]).toEqual(["老兵", 2, true, ["手机"]]);
    engine.language = "en";
    expect(engine.hud().party?.members.map((m) => m.name)).toEqual(["Warrior", "Wizard"]);
    expect(new GameEngine(CONFIG).hud().party).toBeUndefined();
  });

  test("present: a member is left out of the panel while that stat is 0 or less", () => {
    const solo: GameConfig = { ...GAME, party: { ...PARTY, present: "生命上限", members: [PARTY.members[0], { ...PARTY.members[1], stats: { 生命: 0, 生命上限: 0, 等级: 1 } }] } };
    expect(validateConfig(solo)).toEqual([]);
    expect(validateConfig({ ...GAME, party: { ...PARTY, present: "在" } })).toContainEqual({ code: "partyStat", args: ["present", "在"] });
    const engine = new GameEngine(solo);
    new PlaySession(new Compiler(`-> main\n${generateInk(solo)}\n=== main ===\n.\n-> END\n`).Compile(), { setup: (s) => engine.setup(s, "昕") }).start();
    expect(engine.hud().party?.members.map((m) => m.id)).toEqual(["甲"]);
    expect(readConfig({ ...solo, party: { ...solo.party, present: "生命上限" } }).config?.party?.present).toBe("生命上限");
  });
});
