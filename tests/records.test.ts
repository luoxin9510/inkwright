import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { recordAdd, recordAt, recordDrop, recordEntries } from "../src/game/records";
import { readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { generateInk } from "../src/game/inkgen";
import { GameEngine } from "../src/game/engine";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

describe("a record's store", () => {
  test("entries are kept in order; anything can be in one (; and \\ are escaped)", () => {
    let s = "";
    for (const e of ["旧磨坊", "a;b", "c\\d", ""]) s = recordAdd(s, e);
    expect(recordEntries(s)).toEqual(["旧磨坊", "a;b", "c\\d"]);
    expect(recordAt(s, 2)).toBe("a;b");
    expect(recordAt(s, 9)).toBe("");
    expect(recordEntries(recordDrop(s, "a;b"))).toEqual(["旧磨坊", "c\\d"]);
    expect(recordEntries(recordDrop(s, "没有"))).toEqual(recordEntries(s));
    // What the ink fallback writes without the engine (plain ; between entries) reads back too.
    expect(recordEntries("甲;乙")).toEqual(["甲", "乙"]);
    expect(recordEntries("")).toEqual([]);
  });
});

const RECORDS: GameConfig = { ...CONFIG, records: [{ id: "线索", name: { zh: "线索", en: "Clues" } }] };

describe("records in a game", () => {
  test("the config reads records; their ids and counters share the namespace", () => {
    const { config, problems } = readConfig({ rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], records: [{ id: "clues", name: { zh: "线索", en: "Clues" } }] });
    expect(problems).toEqual([]);
    expect(config?.records).toEqual([{ id: "clues", name: { zh: "线索", en: "Clues" } }]);
    expect(validateConfig({ ...RECORDS, records: [{ id: "力量" }] })).toContainEqual({ code: "duplicate", args: ["力量"] });
    expect(validateConfig({ ...RECORDS, resources: [...RECORDS.resources, { id: "线索_数", min: 0, max: 9, initial: 0 }] })).toContainEqual({ code: "duplicate", args: ["线索_数"] });
  });

  const STORY = `-> main
${generateInk(RECORDS)}
=== main ===
~ 记录_加("线索", "旧磨坊")
~ 记录_加("线索", "半张车票")
~ 记录_加("线索", "湿脚印")
有 {记录_数("线索")} 条:{记录_列("线索")}。
抽到:{记录_抽("线索")}。
~ 记录_删("线索", "半张车票")
还剩 {记录_数("线索")} 条:{记录_列("线索")}。
-> END
`;

  test("with the engine: add, count, list, pick (a roll, seeded), remove", () => {
    const engine = new GameEngine(RECORDS, { keepRolls: Infinity });
    const s = new PlaySession(new Compiler(STORY).Compile(), { setup: (st) => engine.setup(st, "昕"), prepare: (st) => engine.seed(st, 7) });
    const text = s.start().paragraphs.map((p) => p.text);
    expect(text[0]).toBe("有 3 条:旧磨坊、半张车票、湿脚印。");
    expect(text[1]).toMatch(/^抽到:(旧磨坊|半张车票|湿脚印)。$/);
    expect(text[2]).toBe("还剩 2 条:旧磨坊、湿脚印。");
    expect(engine.rolls[0]).toMatchObject({ kind: "dice", formula: "1d3", record: { id: "线索", name: "线索" } });
    expect(text[1]).toContain((engine.rolls[0] as { record: { entry: string } }).record.entry);
    expect(engine.hud().records).toEqual([{ id: "线索", name: "线索", entries: ["旧磨坊", "湿脚印"] }]);
  });

  test("a game with two records compiles, and each keeps its own entries", () => {
    const two: GameConfig = { ...CONFIG, records: [{ id: "线索" }, { id: "人物" }] };
    const src = `-> main\n${generateInk(two)}\n=== main ===\n~ 记录_加("线索", "甲")\n~ 记录_加("人物", "乙")\n~ 记录_删("线索", "甲")\n{记录_数("线索")} {记录_数("人物")}\n-> END\n`;
    const engine = new GameEngine(two);
    const s = new PlaySession(new Compiler(src).Compile(), { setup: (st) => engine.setup(st, "昕") });
    expect(s.start().paragraphs[0].text).toBe("0 1");
  });

  test("an empty entry adds nothing and is not counted; a record may be called like the wrappers' temps", () => {
    const odd: GameConfig = { ...CONFIG, records: [{ id: "before" }] };
    const src = `-> main\n${generateInk(odd)}\n=== main ===\n~ 记录_加("before", "")\n~ 记录_加("before", "  ")\n~ 记录_加("before", "甲")\n{记录_数("before")} {记录_抽("before")}\n-> END\n`;
    const engine = new GameEngine(odd);
    const s = new PlaySession(new Compiler(src).Compile(), { setup: (st) => engine.setup(st, "昕") });
    expect(s.start().paragraphs[0].text).toBe("1 甲");
  });

  test("without the engine (Inky): add and count work, the list is the raw text", () => {
    const s = new PlaySession(new Compiler(STORY).Compile());
    const text = s.start().paragraphs.map((p) => p.text);
    expect(text[0]).toBe("有 3 条:旧磨坊;半张车票;湿脚印。");
    expect(s.read("线索_数")).toBe(3);
  });

  test("the player adds and takes out entries by hand; undo puts them back", () => {
    const engine = new GameEngine(RECORDS, { keepRolls: Infinity });
    const src = `-> main\n${generateInk(RECORDS)}\n=== main ===\n线索 {记录_数("线索")}。\n+ [看看] 线索 {记录_数("线索")}:{记录_列("线索")}。\n-> END\n`;
    const s = new PlaySession(new Compiler(src).Compile(), { setup: (st) => engine.setup(st, "昕") });
    s.start();
    s.applyManual({ kind: "record", lang: "zh", var: "线索", count: "线索_数", op: "add", entry: "门外的车", result: null });
    s.applyManual({ kind: "record", lang: "zh", var: "线索", count: "线索_数", op: "add", entry: "一封信", result: null });
    s.applyManual({ kind: "record", lang: "zh", var: "线索", count: "线索_数", op: "remove", entry: "门外的车", result: null });
    expect(engine.hud().records?.[0].entries).toEqual(["一封信"]);
    s.undo();
    expect(engine.hud().records?.[0].entries).toEqual(["门外的车", "一封信"]);
    expect(s.choose(0).paragraphs[0].text).toBe("线索 2:门外的车、一封信。");
  });
});
