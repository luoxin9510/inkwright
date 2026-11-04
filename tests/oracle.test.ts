import { describe, expect, test } from "vitest";
import { askOracle, DEFAULT_ODDS, ODDS, oracleRules, rollTray, thresholdFor } from "../src/play/oracle";
import { CONFIG } from "./fixtures/gameConfig";
import { readConfig, validateConfig } from "../src/game/config";

/** rng that rolls the given d100 faces. */
const d100 = (...faces: number[]) => {
  let i = 0;
  return () => (faces[Math.min(i++, faces.length - 1)] - 1) / 100 + 1e-9;
};

describe("the oracle", () => {
  test("five odds with the default thresholds", () => {
    expect(ODDS).toEqual(["certain", "likely", "even", "unlikely", "remote"]);
    expect(DEFAULT_ODDS).toEqual({ certain: 90, likely: 75, even: 50, unlikely: 25, remote: 10 });
  });

  test("yes at or under the threshold; an extreme yes in its lowest fifth, an extreme no in the top fifth of the no's", () => {
    const rules = oracleRules(undefined, () => undefined);
    expect(askOracle("even", rules, d100(50))).toEqual({ roll: 50, threshold: 50, answer: "yes", extreme: false });
    expect(askOracle("even", rules, d100(51))).toEqual({ roll: 51, threshold: 50, answer: "no", extreme: false });
    expect(askOracle("even", rules, d100(10))).toMatchObject({ answer: "yes", extreme: true });
    expect(askOracle("even", rules, d100(11))).toMatchObject({ answer: "yes", extreme: false });
    expect(askOracle("even", rules, d100(91))).toMatchObject({ answer: "no", extreme: true });
    expect(askOracle("even", rules, d100(90))).toMatchObject({ answer: "no", extreme: false });
    // Likely (75): extreme yes ≤ 15, extreme no > 95.
    expect(askOracle("likely", rules, d100(15))).toMatchObject({ answer: "yes", extreme: true });
    expect(askOracle("likely", rules, d100(96))).toMatchObject({ answer: "no", extreme: true });
    expect(askOracle("likely", rules, d100(95))).toMatchObject({ answer: "no", extreme: false });
  });

  test("the game note can change the thresholds; a chaos resource moves them, within 1..99", () => {
    const resources = { chaos: 8 };
    const rules = oracleRules({ odds: { even: 40 }, chaos: "chaos", chaosStep: 5 }, (id) => resources[id as "chaos"], { min: 1, max: 9 });
    expect(rules.odds.even).toBe(40);
    expect(rules.odds.certain).toBe(90);
    // chaos 8 against the middle 5: three steps of 5 up.
    expect(thresholdFor("even", rules)).toBe(55);
    resources.chaos = 1;
    expect(thresholdFor("even", oracleRules({ odds: { even: 40 }, chaos: "chaos", chaosStep: 5 }, (id) => resources[id as "chaos"], { min: 1, max: 9 }))).toBe(20);
    expect(thresholdFor("certain", oracleRules({ odds: { certain: 98 }, chaos: "chaos", chaosStep: 5 }, () => 9, { min: 1, max: 9 }))).toBe(99);
    expect(thresholdFor("remote", oracleRules({ odds: { remote: 3 }, chaos: "chaos", chaosStep: 5 }, () => 1, { min: 1, max: 9 }))).toBe(1);
  });
});

describe("the tray's dice", () => {
  test("a formula rolls like roll() in a story; a bad one gives null", () => {
    expect(rollTray("2d6+1", undefined, d100(1))).toMatchObject({ formula: "2d6+1", rolls: [1, 1], total: 3 });
    expect(rollTray("4d6kh3", undefined, () => 0.99)).toMatchObject({ total: 18, dropped: [3] });
    expect(rollTray("lots", undefined, d100(1))).toBeNull();
  });

  test("a table rolls its dice and reads the row, in the language given", () => {
    const table = { id: "action", name: { zh: "动作", en: "Action" }, dice: "1d6", rows: [{ range: "1-3", text: { zh: "寻找", en: "Seek" }, id: "seek" }, { range: "4-6", text: { zh: "逃离", en: "Flee" } }] };
    expect(rollTray(undefined, { table, language: "en" }, () => 0)).toMatchObject({ formula: "1d6", total: 1, table: { id: "action", name: "Action", text: "Seek", rowId: "seek" } });
    expect(rollTray(undefined, { table, language: "zh" }, () => 0.99)).toMatchObject({ total: 6, table: { name: "动作", text: "逃离" } });
    expect(CONFIG.tables ?? []).toEqual([]);
  });
});

describe("oracle in the game note", () => {
  const base = { rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], resources: [{ id: "chaos", min: 1, max: 9, initial: 5 }] };

  test("reads odds, a chaos resource and its step; tables can be marked for the tray", () => {
    const { config, problems } = readConfig({ ...base, oracle: { odds: { even: 45 }, chaos: "chaos", chaosStep: 4 }, tables: [{ id: "action", oracle: true, rows: [{ text: "寻找" }, { text: "逃离" }] }] });
    expect(problems).toEqual([]);
    expect(config?.oracle).toEqual({ odds: { even: 45 }, chaos: "chaos", chaosStep: 4 });
    expect(config?.tables?.[0].oracle).toBe(true);
  });

  test("a bad shape, an unknown chaos resource, or odds outside 1..99 are problems", () => {
    expect(readConfig({ ...base, oracle: { odds: { even: "half" } } }).problems).toEqual([{ code: "shape", args: ["oracle"] }]);
    expect(readConfig({ ...base, oracle: { odds: { sometimes: 40 } } }).problems).toEqual([{ code: "shape", args: ["oracle"] }]);
    const { config } = readConfig(base);
    expect(validateConfig({ ...config!, oracle: { chaos: "doom" } })).toContainEqual({ code: "oracleChaos", args: ["doom"] });
    expect(validateConfig({ ...config!, oracle: { odds: { certain: 100 } } })).toContainEqual({ code: "oracleOdds", args: ["certain", "100"] });
    expect(validateConfig({ ...config!, oracle: { odds: { certain: 99, remote: 1 }, chaos: "chaos" } })).toEqual([]);
  });
});
