import { describe, expect, test } from "vitest";
import { Compiler, Story } from "inkjs/full";
import type { GameConfig } from "../src/game/config";
import { GameEngine, type DiceRecord } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { exploreStory } from "../src/play/explore";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

const TABLES: GameConfig = {
  ...CONFIG,
  tables: [
    {
      id: "遭遇", name: { zh: "遭遇", en: "Encounter" },
      rows: [{ range: "1-3", text: { zh: "狼", en: "Wolf" }, id: "wolf" }, { range: "4-5", text: { zh: "熊", en: "Bear" } }, { range: "6", text: { zh: "什么都没有", en: "Nothing" } }],
    },
    { id: "天气", rows: [{ text: { zh: "晴", en: "Sun" } }, { text: { zh: "雨", en: "Rain" } }] },
    { id: "神谕", dice: "d66", rows: [{ range: "11-33", text: { zh: "不", en: "No" } }, { range: "34-66", text: { zh: "是", en: "Yes" } }] },
  ],
};

const STORY = `-> main
${generateInk(TABLES)}
=== main ===
掷出 {掷("2d6+1")}。
遭遇:{查表("遭遇")}。
~ temp r = 掷表("天气")
天气:{表文("天气", r)}。
神谕:{查表("神谕")}。
* [再] -> main
* [走] -> END
`;

/** rng that makes d6 show the given faces, then repeats the last one. */
const faces = (...fs: number[]) => {
  let i = 0;
  return () => (fs[Math.min(i++, fs.length - 1)] - 1) / 6 + 1e-9;
};

const compile = (text = STORY) => new Compiler(text).Compile();

describe("free dice and tables with the engine", () => {
  test("roll() gives the total, table() the row; every roll is logged with its faces", () => {
    const engine = new GameEngine(TABLES, { rng: faces(3, 4, 2, 1, 5, 6) });
    const session = new PlaySession(compile(), { setup: (s) => engine.setup(s, "昕") });
    const step = session.start();
    expect(step.paragraphs.map((p) => p.text)).toEqual(["掷出 8。", "遭遇:狼。", "天气:晴。", "神谕:是。"]);
    const rolls = engine.rolls as DiceRecord[];
    expect(rolls.map((r) => r.kind)).toEqual(["dice", "dice", "dice", "dice"]);
    expect(rolls[0]).toMatchObject({ formula: "2d6+1", rolls: [3, 4], total: 8, index: 0, turn: -1 });
    expect(rolls[0].table).toBeUndefined();
    expect(rolls[1]).toMatchObject({ formula: "1d6", rolls: [2], total: 2, index: 1, table: { id: "遭遇", name: "遭遇", text: "狼", rowId: "wolf" } });
    expect(rolls[2]).toMatchObject({ formula: "1d2", rolls: [1], total: 1, table: { id: "天气", name: "天气", text: "晴" } });
    expect(rolls[2].table).not.toHaveProperty("rowId");
    expect(rolls[3]).toMatchObject({ formula: "d66", rolls: [5, 6], total: 56, table: { id: "神谕", text: "是" } });
    expect(session.read("掷骰次数")).toBe(4);
  });

  test("the card's row text follows the engine's language; the story's follows the story's", () => {
    const engine = new GameEngine(TABLES, { rng: faces(3, 4, 2, 1, 5, 6) });
    engine.language = "en";
    const session = new PlaySession(compile(), { language: "en", setup: (s) => engine.setup(s, "昕") });
    const step = session.start();
    expect(step.paragraphs[1].text).toBe("遭遇:Wolf。");
    expect((engine.rolls[1] as DiceRecord).table?.text).toBe("Wolf");
  });

  test("a roll inside a bilingual string (ink's string generation) is allowed; both strings roll, so a temp rolls once", () => {
    const engine = new GameEngine(TABLES, { rng: faces(1, 4, 1) }); // on 1d2 a "4" of six is the second face
    const story = compile(`-> main\n${generateInk(TABLES)}\n=== main ===\n{双("天气:{查表("天气")}。", "Weather: {查表("天气")}.")}\n~ temp w = 查表("天气")\n{双("又:{w}。", "Again: {w}.")}\n-> END\n`);
    const session = new PlaySession(story, { setup: (s) => engine.setup(s, "昕") });
    expect(session.start().paragraphs.map((p) => p.text)).toEqual(["天气:晴。", "又:晴。"]);
    expect(engine.rolls.map((r) => r.total)).toEqual([1, 2, 1]);
    expect(session.read("掷骰次数")).toBe(3);
  });

  test("a formula the engine cannot read rolls nothing and gives 0", () => {
    const engine = new GameEngine(TABLES, { rng: faces(3) });
    const session = new PlaySession(compile(`-> main\n${generateInk(TABLES)}\n=== main ===\n{掷("lots")}\n-> END\n`), { setup: (s) => engine.setup(s) });
    expect(session.start().paragraphs[0].text).toBe("0");
    expect(engine.rolls[0]).toMatchObject({ kind: "dice", formula: "lots", rolls: [], total: 0, unknown: true });
  });

  test("without an rng the dice follow the run's seed: back and choose again rolls the same", () => {
    const engine = new GameEngine(TABLES);
    const session = new PlaySession(compile(), { setup: (s) => engine.setup(s, "昕") });
    session.start();
    const first = session.choose(0).paragraphs.map((p) => p.text);
    const rolls = engine.rolls.map((r) => r.total);
    session.back();
    expect(session.choose(0).paragraphs.map((p) => p.text)).toEqual(first);
    expect(engine.rolls.map((r) => r.total)).toEqual(rolls);
  });

  test("the explorer rolls free dice from a fixed seed, so two walks agree", () => {
    const story = compile();
    const a = exploreStory(story, { game: TABLES, character: "昕", maxSteps: 50 });
    const b = exploreStory(story, { game: TABLES, character: "昕", maxSteps: 50 });
    expect(a.endings).toEqual(b.endings);
    expect(a.coverage.places.missed).toEqual([]);
  });
});

test("without the engine the fallbacks are flat: a table's average, 1 for other dice", () => {
  const s = new Story(compile().ToJson() as string);
  s.allowExternalFunctionFallbacks = true;
  s.EvaluateFunction("选主角", ["昕"]);
  let out = "";
  while (s.canContinue) out += s.Continue();
  // 2d6+1 is no table's dice: 1. 遭遇 rolls 1d6: 4 → 熊. 天气 1d2: 2 → 雨. 神谕 d66: 39 → 是.
  expect(out.trim().split("\n")).toEqual(["掷出 1。", "遭遇:熊。", "天气:雨。", "神谕:是。"]);
});
