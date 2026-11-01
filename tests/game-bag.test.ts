import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { averageRoll, bagPool, chance, resolve, tokenText, type BagRules } from "../src/game/dice";
import { GameEngine, type CheckRecord } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { rollLine } from "../src/play/journal";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

// An Arkham-style bag: +1, 0, -1 (twice), -2, the skull, the auto-fail and the elder sign.
const BAG: BagRules = {
  kind: "bag",
  tokens: [
    { value: 1 }, { value: 0 }, { value: -1, count: 2 }, { value: -2 },
    { id: "skull", name: { zh: "骷髅", en: "Skull" }, value: -2 },
    { id: "tentacle", name: { zh: "触手", en: "Tentacle" }, auto: "fail" },
    { id: "elder", name: { zh: "古印", en: "Elder Sign" }, auto: "success", value: 1 },
  ],
};

/** An rng that draws the n-th token of the pool (0-based). */
const draw = (pool: number, n: number) => () => n / pool + 1e-9;

describe("chaos bag rules", () => {
  test("the pool repeats a token `count` times; a draw grades skill + modifiers + token vs the difficulty", () => {
    const pool = bagPool(BAG);
    expect(pool.map((t) => t.id ?? t.value)).toEqual([1, 0, -1, -1, -2, "skull", "tentacle", "elder"]);
    // skill 3 + modifier 1 + token: +1 → 5 vs 4 success; -2 → 2 vs 4 fail (no partial band by default).
    const win = resolve(BAG, { level: 3, difficulty: 4, modifiers: [{ source: "x", value: 1 }] }, draw(8, 0));
    expect(win).toMatchObject({ band: 3, total: 5, rolls: [], token: { id: "1", value: 1 } });
    const lose = resolve(BAG, { level: 3, difficulty: 4 }, draw(8, 4));
    expect(lose).toMatchObject({ band: 1, total: 1, token: { id: "-2", value: -2 } });
    expect(resolve(BAG, { level: 3, difficulty: 3 }, draw(8, 5)).token).toEqual({ id: "skull", value: -2 });
  });

  test("an auto-fail token fails whatever the numbers; an auto-success token is a critical", () => {
    expect(resolve(BAG, { level: 20, difficulty: 1 }, draw(8, 6))).toMatchObject({ band: 0, total: 20, token: { id: "tentacle", auto: "fail" } });
    expect(resolve(BAG, { level: 0, difficulty: 20 }, draw(8, 7))).toMatchObject({ band: 4, total: 1, token: { id: "elder", auto: "success", value: 1 } });
  });

  test("partialBelow gives a partial band just under the difficulty", () => {
    const soft: BagRules = { ...BAG, partialBelow: 2 };
    expect(resolve(soft, { level: 3, difficulty: 4 }, draw(8, 4)).band).toBe(1); // 1 vs 4: 3 below, out
    expect(resolve(soft, { level: 3, difficulty: 4 }, draw(8, 2)).band).toBe(2); // 2 vs 4: 2 below, partial
    expect(resolve(soft, { level: 3, difficulty: 5 }, draw(8, 4)).band).toBe(1); // 1 vs 5: 4 below
  });

  test("the odds enumerate the bag; the average token feeds the ink fallback", () => {
    // skill 3 vs 4: +1 passes, the elder sign is a critical; 0, -1, -1, -2 and the skull fail; the tentacle is a critical fail.
    const c = chance(BAG, { level: 3, difficulty: 4 });
    expect(c.bands.map((b) => Math.round(b * 8))).toEqual([1, 5, 0, 1, 1]);
    expect(c.success).toBeCloseTo(2 / 8, 6);
    // partialBelow 1: the 0 token lands one short, a partial.
    expect(chance({ ...BAG, partialBelow: 1 }, { level: 3, difficulty: 4 }).bands.map((b) => Math.round(b * 8))).toEqual([1, 4, 1, 1, 1]);
    expect(averageRoll(BAG)).toBeCloseTo(-4 / 8, 9); // the eight tokens sum to -4
    expect(Object.is(averageRoll({ kind: "bag", tokens: [{ value: -1 }, { value: 1 }] }), 0)).toBe(true);
    expect(averageRoll({ kind: "bag", tokens: [{ value: 2 }, { value: 4 }] })).toBe(3);
  });

  test("a forced band draws nothing", () => {
    expect(resolve(BAG, { level: 3, difficulty: 4 }, draw(8, 6), 3)).toMatchObject({ band: 3, rolls: [], total: 0 });
    expect(resolve(BAG, { level: 3, difficulty: 4 }, draw(8, 6), 3).token).toBeUndefined();
  });

  test("a token's text: its name, else the auto wording, else its signed value", () => {
    const auto = { fail: "自动失败", success: "自动成功" };
    expect(tokenText({ id: "skull", name: "骷髅", value: -2 }, auto)).toBe("骷髅");
    expect(tokenText({ id: "tentacle", auto: "fail" }, auto)).toBe("自动失败");
    expect(tokenText({ id: "1", value: 1 }, auto)).toBe("+1");
    expect(tokenText({ id: "-2", value: -2 }, auto)).toBe("-2");
    expect(tokenText({ id: "0", value: 0 }, auto)).toBe("0");
  });
});

describe("a bag in the game note", () => {
  const base = { skills: [{ id: "wits" }], characters: [{ id: "you", skills: { wits: 3 } }] };

  test("readConfig takes the bag's shape: every token has a value or an auto kind", () => {
    const ok = readConfig({ ...base, rules: { kind: "bag", tokens: [{ value: 1 }, { id: "skull", name: { zh: "骷髅" }, value: -2, count: 2 }, { auto: "fail" }], partialBelow: 1 } });
    expect(ok.problems).toEqual([]);
    expect(ok.config?.rules).toEqual({ kind: "bag", tokens: [{ value: 1 }, { id: "skull", name: { zh: "骷髅" }, value: -2, count: 2 }, { auto: "fail" }], partialBelow: 1 });
    expect(readConfig({ ...base, rules: { kind: "bag", tokens: [{ id: "blank" }] } }).problems).toEqual([{ code: "shape", args: ["rules.tokens"] }]);
    expect(readConfig({ ...base, rules: { kind: "bag", tokens: [{ auto: "maybe" }] } }).problems).toEqual([{ code: "shape", args: ["rules.tokens"] }]);
    expect(readConfig({ ...base, rules: { kind: "bag", tokens: [{ value: 1 }], partialBelow: "2" } }).problems).toEqual([{ code: "shape", args: ["rules.partialBelow"] }]);
    expect(readConfig({ ...base, rules: { kind: "bag" } }).problems).toEqual([{ code: "shape", args: ["rules.tokens"] }]);
  });

  test("an empty bag, or two tokens that share an id, is reported", () => {
    expect(validateConfig({ ...CONFIG, rules: { kind: "bag", tokens: [] } })).toEqual([{ code: "tokens", args: [] }]);
    expect(validateConfig({ ...CONFIG, rules: BAG })).toEqual([]);
    // Two -1 tokens, one named: both would be "-1", so the card could not tell them apart; the named one needs an id.
    expect(validateConfig({ ...CONFIG, rules: { kind: "bag", tokens: [{ value: -1 }, { value: -1, name: { zh: "教徒" } }] } })).toEqual([{ code: "duplicate", args: ["-1"] }]);
    expect(validateConfig({ ...CONFIG, rules: { kind: "bag", tokens: [{ value: -1 }, { id: "cultist", value: -1, name: { zh: "教徒" } }, { auto: "fail" }, { auto: "fail" }] } })).toEqual([{ code: "duplicate", args: ["fail"] }]);
    // `count` is the way to put the same token in twice.
    expect(validateConfig({ ...CONFIG, rules: { kind: "bag", tokens: [{ value: -1, count: 2 }] } })).toEqual([]);
  });
});

describe("a bag with the engine", () => {
  const config: GameConfig = { ...CONFIG, rules: BAG };
  const story = () => new Compiler(`-> main
${generateInk(config)}
=== main ===
门。
+ [撬开门 #check:力量:3]
    { 检定("力量", 3) >= 3: 开了。|断了。 }
    -> END
`).Compile();

  test("a check draws a token, named in the engine's language, and the card follows it", () => {
    const engine = new GameEngine(config, { rng: draw(8, 5) }); // the skull
    const session = new PlaySession(story(), { setup: (s) => engine.setup(s, "昕") });
    session.start();
    // 力量 2 + skull -2 = 0 vs 3: fail; the odds count the whole bag (+1 and the elder sign pass).
    expect(engine.describeChoice({ tags: ["check:力量:3"] })?.chance.success).toBeCloseTo(2 / 8, 6);
    const step = session.choose(0);
    expect(step.paragraphs[0].text).toBe("断了。");
    const r = engine.rolls[0] as CheckRecord;
    expect(r).toMatchObject({ skill: "力量", level: 2, total: 0, band: 1, rolls: [], token: { id: "skull", name: "骷髅", value: -2 } });
    expect(rollLine(r, "zh", [{ id: "力量", name: "力量" }])).toBe("🎲 力量 3: 骷髅 +2 = 0 · 失败");
    engine.language = "en";
    expect(rollLine(r, "en", [{ id: "力量", name: "Strength" }])).toBe("🎲 Strength 3: 骷髅 +2 = 0 · Failure");
  });

  test("the auto-fail and a plain number are named by their wording", () => {
    const auto = new GameEngine(config, { rng: draw(8, 6) });
    const s1 = new PlaySession(story(), { setup: (s) => auto.setup(s, "阿波") });
    s1.start();
    expect(s1.choose(0).paragraphs[0].text).toBe("断了。");
    const r1 = auto.rolls[0] as CheckRecord;
    expect(r1).toMatchObject({ level: 5, total: 5, band: 0, token: { id: "tentacle", name: "触手", auto: "fail" } });
    expect(rollLine(r1, "en", [])).toBe("🎲 力量 3: 触手 +5 = 5 · Critical failure");
    const plain = new GameEngine(config, { rng: draw(8, 0) });
    const s2 = new PlaySession(story(), { setup: (s) => plain.setup(s, "昕") });
    s2.start();
    expect(s2.choose(0).paragraphs[0].text).toBe("开了。");
    const r2 = plain.rolls[0] as CheckRecord;
    expect(r2.token).toEqual({ id: "1", value: 1 });
    expect(rollLine(r2, "zh", [])).toBe("🎲 力量 3: +1 +2 = 3 · 成功");
  });

  test("the seeded draw repeats: back and the same choice again draws the same token", () => {
    const engine = new GameEngine(config);
    const session = new PlaySession(story(), { setup: (s) => engine.setup(s, "昕") });
    session.start();
    session.choose(0);
    const first = (engine.rolls[0] as CheckRecord).token;
    session.back();
    session.choose(0);
    expect((engine.rolls.at(-1) as CheckRecord).token).toEqual(first);
  });

  test("without the engine the fallback compares skill plus the average token with the difficulty", () => {
    const ink = generateInk(config);
    expect(ink).toMatch(/\{ \S+\(\S+\) \+ -0\.5 >= \S+:/); // the bag's mean token, -4/8
    const session = new PlaySession(story());
    session.start();
    expect(session.choose(0).paragraphs[0].text).toBe("断了。"); // skill 0 without a preset
    const strong = generateInk({ ...config, rules: { kind: "bag", tokens: [{ value: 2 }, { value: 4 }] } });
    expect(strong).toMatch(/\{ \S+\(\S+\) \+ 3 >= \S+:/);
  });
});
