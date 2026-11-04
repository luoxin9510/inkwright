import { describe, expect, test } from "vitest";
import { Compiler, Story } from "inkjs/full";
import { readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { GameEngine, type DiceRecord } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { rollLine } from "../src/play/journal";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

const DECKS: GameConfig = {
  ...CONFIG,
  decks: [{
    id: "线索", name: { zh: "线索", en: "Clues" },
    cards: [
      { id: "血手印", name: { zh: "血手印", en: "Bloody handprint" }, desc: { zh: "门把手上。", en: "On the door handle." } },
      { id: "半张票", name: { zh: "半张票", en: "Half a ticket" } },
      { id: "钥匙扣", name: { zh: "钥匙扣", en: "Key ring" } },
    ],
  }],
};

const STORY = `-> main
${generateInk(DECKS)}
VAR 手牌 = ()
=== main ===
~ 手牌 += 抽牌("线索")
~ 手牌 += 抽牌("线索")
手牌:{手牌}。剩 {剩余牌数("线索")}。
~ 手牌 += 抽牌("线索")
~ temp e = 抽牌("线索")
空:{LIST_COUNT(e)}。剩 {剩余牌数("线索")}。
~ 洗牌("线索")
洗后剩 {剩余牌数("线索")}。
-> END
`;

/** rng that makes d6 show the given faces, then repeats the last one. */
const faces = (...fs: number[]) => {
  let i = 0;
  return () => (fs[Math.min(i++, fs.length - 1)] - 1) / 6 + 1e-9;
};

describe("decks", () => {
  test("the generated ink declares a LIST and a pile per deck, and draw/shuffle/deck_left", () => {
    const ink = generateInk(DECKS);
    expect(ink).toContain("LIST 线索 = 血手印, 半张票, 钥匙扣\nVAR 线索_牌堆 = (血手印, 半张票, 钥匙扣)");
    expect(ink).toContain('~ temp 抽出的牌 = ()\n{ 牌堆名 == "线索" and LIST_COUNT(线索_牌堆) > 0:\n    ~ 抽出的牌 = 第几张(线索_牌堆, 掷骰(LIST_COUNT(线索_牌堆), "线索"))\n    ~ 线索_牌堆 -= 抽出的牌\n    ~ return 抽出的牌\n}');
    expect(ink).toContain('{ 牌堆名 == "线索":\n    ~ 线索_牌堆 = LIST_ALL(线索)\n}');
    expect(ink).toContain('{ 牌堆名 == "线索":\n    ~ return LIST_COUNT(线索_牌堆)\n}');
  });

  test("draws come out of the pile at random and without replacement; shuffle puts them back", () => {
    // 1d3 with a 3 of six is the second card; 1d2 with a 1 the first; the last card is drawn on 1d1.
    const engine = new GameEngine(DECKS, { rng: faces(3, 1, 1) });
    const session = new PlaySession(new Compiler(STORY).Compile(), { setup: (s) => engine.setup(s, "昕") });
    const step = session.start();
    expect(step.paragraphs.map((p) => p.text)).toEqual(["手牌:血手印, 半张票。剩 1。", "空:0。剩 0。", "洗后剩 3。"]);
    const rolls = engine.rolls as DiceRecord[];
    expect(rolls).toHaveLength(3);
    expect(rolls[0]).toMatchObject({ kind: "dice", formula: "1d3", total: 2, deck: { id: "线索", name: "线索", card: "半张票", cardId: "半张票" } });
    expect(rolls[0].deck).not.toHaveProperty("desc");
    expect(rolls[1]).toMatchObject({ formula: "1d2", total: 1, deck: { card: "血手印", cardId: "血手印", desc: "门把手上。" } });
    expect(rolls[2]).toMatchObject({ formula: "1d1", total: 1, deck: { card: "钥匙扣" } });
    expect(engine.hud().decks).toEqual([{ id: "线索", name: "线索", left: 3, total: 3 }]);
    expect(rollLine(rolls[1], "en")).toBe("🎲 线索: 1 = 1 · 血手印");
  });

  test("the HUD counts the pile as it goes, named in the engine's language", () => {
    const engine = new GameEngine(DECKS, { rng: faces(1) });
    engine.language = "en";
    const story = new Compiler(`-> main\n${generateInk(DECKS)}\n=== main ===\n~ temp c = 抽牌("线索")\n抽到 {c}。\n* [再] -> main\n* [走] -> END\n`).Compile();
    const session = new PlaySession(story, { setup: (s) => engine.setup(s, "昕") });
    session.start();
    expect(engine.hud().decks).toEqual([{ id: "线索", name: "Clues", left: 2, total: 3 }]);
    expect((engine.rolls[0] as DiceRecord).deck).toMatchObject({ name: "Clues", card: "Bloody handprint", desc: "On the door handle." });
    session.choose(0);
    expect(engine.hud().decks?.[0].left).toBe(1);
    session.back();
    expect(engine.hud().decks?.[0].left).toBe(2);
  });

  test("without the engine the first card comes out each time", () => {
    const s = new Story(new Compiler(STORY).Compile().ToJson() as string);
    s.allowExternalFunctionFallbacks = true;
    let out = "";
    while (s.canContinue) out += s.Continue();
    expect(out.trim().split("\n")).toEqual(["手牌:血手印, 半张票。剩 1。", "空:0。剩 0。", "洗后剩 3。"]);
  });

  test("config: deck and card ids share the namespace, a deck needs cards, the shape is checked", () => {
    expect(validateConfig({ ...DECKS, decks: [{ id: "力量", cards: [] }, { id: "a", cards: [{ id: "手机" }] }] }).map((p) => p.code)).toEqual(["duplicate", "deckCards", "duplicate"]);
    const fm = { rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "s" }], characters: [{ id: "c", skills: {} }], decks: [{ id: "d", cards: [{ id: "x", name: "X" }] }] };
    expect(readConfig(fm).problems).toEqual([]);
    expect(readConfig(fm).config?.decks).toEqual([{ id: "d", cards: [{ id: "x", name: "X" }] }]);
    expect(readConfig({ ...fm, decks: [{ id: "d", cards: "x" }] }).problems.map((p) => p.code)).toEqual(["shape"]);
  });
});

test("cards may be called like the temps the generated ink used to have (c, none); the temps' own names are reserved", () => {
  const deck = (ids: string[]): GameConfig => ({ ...CONFIG, decks: [{ id: "牌堆", cards: ids.map((id) => ({ id })) }] });
  const src = (cfg: GameConfig) => `-> main\n${generateInk(cfg)}\n=== main ===\n~ temp x = 抽牌("牌堆")\n{x}\n-> END\n`;
  const cfg = deck(["c", "none", "before"]);
  const engine = new GameEngine(cfg);
  const s = new PlaySession(new Compiler(src(cfg)).Compile(), { setup: (st) => engine.setup(st, "昕") });
  expect(s.start().errors).toEqual([]);
  expect(validateConfig(deck(["抽出的牌"]))).toContainEqual({ code: "duplicate", args: ["抽出的牌"] });
  // Two decks: the draw function declares its temp once, for every deck.
  const two: GameConfig = { ...CONFIG, decks: [{ id: "甲堆", cards: [{ id: "甲" }] }, { id: "乙堆", cards: [{ id: "乙" }] }] };
  const e2 = new GameEngine(two);
  const s2 = new PlaySession(new Compiler(`-> main\n${generateInk(two)}\n=== main ===\n{抽牌("乙堆")} {抽牌("甲堆")} {抽牌("甲堆")}。\n-> END\n`).Compile(), { setup: (st) => e2.setup(st, "昕") });
  expect(s2.start().paragraphs[0].text).toBe("乙 甲 。");
});
