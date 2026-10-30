import { describe, expect, test } from "vitest";
import { chance, resolve, type RulesConfig, seededDice } from "../src/game/dice";

const twoD6: RulesConfig = { kind: "sum", dice: [6, 6] };
const d20: RulesConfig = { kind: "sum", dice: [20], partialBelow: 0 };
const d100: RulesConfig = { kind: "rollUnder", sides: 100 };

/** An rng that makes dice with `sides` show the given faces in order. */
const facesOf = (sides: number) => (...fs: number[]) => {
  let i = 0;
  return () => (fs[i++] - 1) / sides + 1e-9;
};

describe("sum dice (2d6 + skill vs difficulty)", () => {
  const faces = facesOf(6);
  const faces20 = facesOf(20);
  test("bands: total vs difficulty, partial within 2 below", () => {
    // 3 + 4 = 7, skill 3 => 10 vs 10: success
    expect(resolve(twoD6, { level: 3, difficulty: 10 }, faces(3, 4)).band).toBe(3);
    // 2 + 3 = 5, skill 3 => 8 vs 10: partial (2 below)
    expect(resolve(twoD6, { level: 3, difficulty: 10 }, faces(2, 3)).band).toBe(2);
    // 1 + 2 = 3, skill 3 => 6 vs 10: fail
    expect(resolve(twoD6, { level: 3, difficulty: 10 }, faces(1, 2)).band).toBe(1);
  });

  test("double 6 always succeeds critically, double 1 always fails critically", () => {
    expect(resolve(twoD6, { level: 0, difficulty: 20 }, faces(6, 6)).band).toBe(4);
    expect(resolve(twoD6, { level: 10, difficulty: 2 }, faces(1, 1)).band).toBe(0);
  });

  test("modifiers add to the total and are reported", () => {
    const r = resolve(twoD6, { level: 2, difficulty: 10, modifiers: [{ source: "队友帮忙", value: 1 }] }, faces(3, 4));
    expect(r.total).toBe(10);
    expect(r.band).toBe(3);
    expect(r.modifiers).toEqual([{ source: "队友帮忙", value: 1 }]);
  });

  test("exact success chance from enumerating the dice", () => {
    // need 7+ on 2d6: 21/36
    const c = chance(twoD6, { level: 3, difficulty: 10 });
    expect(c.success).toBeCloseTo(21 / 36, 6);
    expect(c.bands[4]).toBeCloseTo(1 / 36, 6); // double 6
    expect(c.bands[0]).toBeCloseTo(1 / 36, 6); // double 1
    expect(c.bands.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // impossible targets still have the crit success chance
    expect(chance(twoD6, { level: 0, difficulty: 30 }).success).toBeCloseTo(1 / 36, 6);
  });

  test("d20 has no partial band when partialBelow is 0", () => {
    expect(resolve(d20, { level: 2, difficulty: 15 }, faces20(12)).band).toBe(1);
    expect(resolve(d20, { level: 2, difficulty: 15 }, faces20(13)).band).toBe(3);
    expect(resolve(d20, { level: 2, difficulty: 15 }, faces20(20)).band).toBe(4);
    expect(chance(d20, { level: 2, difficulty: 15 }).success).toBeCloseTo(8 / 20, 6);
  });

  test("a forced band skips the dice (for exploring every outcome)", () => {
    const r = resolve(twoD6, { level: 3, difficulty: 10 }, faces(1, 1), 3);
    expect(r.band).toBe(3);
    expect(r.rolls).toEqual([]);
  });
});

describe("roll-under d100 (CoC style)", () => {
  const faces = facesOf(100);
  test("roll at or under the skill succeeds; a fifth is a critical", () => {
    expect(resolve(d100, { level: 60, difficulty: 0 }, faces(60)).band).toBe(3);
    expect(resolve(d100, { level: 60, difficulty: 0 }, faces(61)).band).toBe(1);
    expect(resolve(d100, { level: 60, difficulty: 0 }, faces(12)).band).toBe(4);
    expect(resolve(d100, { level: 60, difficulty: 0 }, faces(100)).band).toBe(0);
  });
  test("chance is the skill percentage", () => {
    expect(chance(d100, { level: 60, difficulty: 0 }).success).toBeCloseTo(0.6, 6);
  });
});

describe("seededDice", () => {
  const roll = (seed: number, index: number) => {
    const rng = seededDice(seed, index);
    return [rng(), rng(), rng()];
  };

  test("the same seed and check number give the same faces; another seed or number gives others", () => {
    expect(roll(42, 3)).toEqual(roll(42, 3));
    expect(roll(42, 3)).not.toEqual(roll(42, 4));
    expect(roll(42, 3)).not.toEqual(roll(43, 3));
    expect(roll(0, 0)).not.toEqual(roll(0, 1));
  });

  test("values are in [0, 1) and the dice of one check are not all alike", () => {
    for (const v of roll(7, 0)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(roll(1, 1)).size).toBeGreaterThan(1);
  });
});
