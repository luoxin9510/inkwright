import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { averageFormula, formatFormula, formulaSpan, parseFormula, rollFormula } from "../src/game/dice";
import { GameEngine, type DiceRecord } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { rollLine } from "../src/play/journal";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

/** rng that makes an s-sided die show the given faces, in order. */
const dice = (sides: number, ...fs: number[]) => {
  let i = 0;
  return () => (fs[Math.min(i++, fs.length - 1)] - 1) / sides + 1e-9;
};

describe("keep highest / lowest", () => {
  test("4d6kh3, 2d20kl1 and the kh / kl shorthand for one die", () => {
    expect(parseFormula("4d6kh3")).toEqual({ count: 4, sides: 6, bonus: 0, d66: false, keep: { high: true, count: 3 } });
    expect(parseFormula("2d20kl1")).toEqual({ count: 2, sides: 20, bonus: 0, d66: false, keep: { high: false, count: 1 } });
    expect(parseFormula("2d20kh")).toEqual(parseFormula("2d20kh1"));
    expect(parseFormula(" 2D20KL +3 ")).toEqual({ count: 2, sides: 20, bonus: 3, d66: false, keep: { high: false, count: 1 } });
    for (const bad of ["4d6kh5", "4d6kh0", "d66kh1", "4d6!kh3", "4d6kh3>=5", "4d6kx3"]) expect(parseFormula(bad), bad).toBeNull();
    expect(formatFormula(parseFormula("4d6kh3")!)).toBe("4d6kh3");
    expect(formatFormula(parseFormula("2d20kl-1")!)).toBe("2d20kl1-1");
  });

  test("rolling keeps the highest (or lowest) faces; the others are dropped, by index, the later of equal faces first", () => {
    expect(rollFormula(parseFormula("4d6kh3")!, dice(6, 2, 6, 3, 6))).toEqual({ rolls: [2, 6, 3, 6], total: 15, dropped: [0] });
    expect(rollFormula(parseFormula("2d20kl1+2")!, dice(20, 17, 4))).toEqual({ rolls: [17, 4], total: 6, dropped: [0] });
    expect(rollFormula(parseFormula("2d6kh1")!, dice(6, 5, 5))).toEqual({ rolls: [5, 5], total: 5, dropped: [1] });
    // Plain dice drop nothing and say so by leaving the field out.
    expect(rollFormula(parseFormula("2d6")!, dice(6, 1, 2))).toEqual({ rolls: [1, 2], total: 3 });
  });

  test("span and average (exact: order statistics of the kept dice)", () => {
    expect(formulaSpan(parseFormula("4d6kh3")!)).toEqual({ min: 3, max: 18 });
    expect(averageFormula(parseFormula("4d6kh3")!)).toBe(12); // 12.24
    expect(averageFormula(parseFormula("2d20kh")!)).toBe(14); // 13.825
    expect(averageFormula(parseFormula("2d20kl")!)).toBe(7); // 7.175
    expect(averageFormula(parseFormula("2d20kl+3")!)).toBe(10);
  });
});

describe("dice pools", () => {
  test("5d6>=5 counts the dice showing 5 or more; ≥ works too; exploding pools; a bonus adds successes", () => {
    expect(parseFormula("5d6>=5")).toEqual({ count: 5, sides: 6, bonus: 0, d66: false, pool: 5 });
    expect(parseFormula("5d6≥5")).toEqual(parseFormula("5d6>=5"));
    expect(parseFormula("5d10!>=8+1")).toEqual({ count: 5, sides: 10, bonus: 1, d66: false, explode: true, pool: 8 });
    for (const bad of ["5d6>=7", "5d6>=0", "d66>=3", "5d6>5"]) expect(parseFormula(bad), bad).toBeNull();
    expect(formatFormula(parseFormula("5d10!>=8+1")!)).toBe("5d10!>=8+1");
  });

  test("rolling: the total is the number of hits (plus the bonus); misses are dropped", () => {
    expect(rollFormula(parseFormula("5d6>=5")!, dice(6, 6, 2, 5, 1, 5))).toEqual({ rolls: [6, 2, 5, 1, 5], total: 3, dropped: [1, 3] });
    // An exploding die's extra faces are dice of the pool too.
    expect(rollFormula(parseFormula("2d10!>=8")!, dice(10, 10, 9, 3))).toEqual({ rolls: [10, 9, 3], total: 2, dropped: [2] });
  });

  test("span and average", () => {
    expect(formulaSpan(parseFormula("5d6>=5+1")!)).toEqual({ min: 1, max: 6 });
    expect(averageFormula(parseFormula("5d6>=5")!)).toBe(2); // 5 · 1/3
    expect(averageFormula(parseFormula("6d10!>=8")!)).toBe(2); // 6 · 0.3 · 10/9 = 2
  });
});

test("the engine logs which faces were dropped; the journal strikes them out", () => {
  const engine = new GameEngine(CONFIG, { rng: dice(6, 2, 6, 3, 6, 6, 2, 5) });
  const story = new Compiler(`-> main\n${generateInk(CONFIG)}\n=== main ===\n属性 {掷("4d6kh3")},命中 {掷("3d6>=5")}。\n-> END\n`).Compile();
  const session = new PlaySession(story, { setup: (s) => engine.setup(s, "昕") });
  expect(session.start().paragraphs[0].text).toBe("属性 15,命中 2。");
  const [stat, pool] = engine.rolls as DiceRecord[];
  expect(stat).toMatchObject({ formula: "4d6kh3", rolls: [2, 6, 3, 6], total: 15, dropped: [0] });
  expect(pool).toMatchObject({ formula: "3d6>=5", rolls: [6, 2, 5], total: 2, dropped: [1] });
  expect(rollLine(stat, "zh")).toBe("🎲 4d6kh3: ~~2~~+6+3+6 = 15");
  expect(rollLine(pool, "en")).toBe("🎲 3d6>=5: 6+~~2~~+5 = 2");
});
