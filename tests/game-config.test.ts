import { describe, expect, test } from "vitest";
import { Compiler, Story } from "inkjs/full";
import { collectModifiers, parseCheckTag, parseVoiceTag, validateConfig, type GameConfig } from "../src/game/config";
import { CONFIG } from "./fixtures/gameConfig";
import { generateInk } from "../src/game/inkgen";


describe("tags", () => {
  test("check tags: skill, difficulty (number or ladder name), red", () => {
    expect(parseCheckTag("check:力量:12", CONFIG)).toEqual({ skill: "力量", difficulty: 12, red: false });
    expect(parseCheckTag("check:理智:困难:红", CONFIG)).toEqual({ skill: "理智", difficulty: 12, red: true });
    expect(parseCheckTag("check:理智:hard:red", CONFIG)).toBeNull(); // unknown ladder name
    expect(parseCheckTag("check:理智:constructor", CONFIG)).toBeNull(); // inherited keys are not difficulties
    expect(parseCheckTag("check:理智:0", CONFIG)).toBeNull();
    expect(parseCheckTag("check:理智", CONFIG)).toBeNull(); // sum systems need a difficulty
    expect(parseCheckTag("check:理智:红", CONFIG)).toBeNull();
    expect(parseCheckTag("check:歌唱:10", CONFIG)).toBeNull(); // unknown skill
    expect(parseCheckTag("voice:理智", CONFIG)).toBeNull();
  });
  test("roll-under systems ignore the difficulty, so the tag may leave it out", () => {
    const config: GameConfig = { ...CONFIG, rules: { kind: "rollUnder", sides: 100 } };
    expect(parseCheckTag("check:理智", config)).toEqual({ skill: "理智", difficulty: 0, red: false });
    expect(parseCheckTag("check:理智:红", config)).toEqual({ skill: "理智", difficulty: 0, red: true });
    expect(parseCheckTag("check:理智:0", config)).toEqual({ skill: "理智", difficulty: 0, red: false });
    expect(parseCheckTag("check:理智:困难:红", config)).toEqual({ skill: "理智", difficulty: 12, red: true });
    expect(parseCheckTag("check:歌唱", config)).toBeNull();
  });
  test("voice tags", () => {
    expect(parseVoiceTag("voice:理智", CONFIG)).toBe("理智");
    expect(parseVoiceTag("voice:歌唱", CONFIG)).toBeNull();
  });
});

describe("modifiers from state", () => {
  const state = (vars: Record<string, unknown>) => (name: string) => vars[name];
  test("per-step penalties and conditional modifiers, only for their skill", () => {
    expect(collectModifiers(CONFIG, "理智", state({ 恐惧: 55 }))).toEqual([{ source: "恐惧", value: -2 }]);
    expect(collectModifiers(CONFIG, "理智", state({ 恐惧: 24 }))).toEqual([]);
    expect(collectModifiers(CONFIG, "力量", state({ 恐惧: 55, 受伤: true }))).toEqual([{ source: "受伤", value: -2 }]);
    expect(collectModifiers(CONFIG, "力量", state({ 受伤: false }))).toEqual([]);
  });
});

describe("modifiers read from a real story", () => {
  test("bool, int and string variables from inkjs match the rules", () => {
    const config: GameConfig = {
      ...CONFIG,
      modifiers: [
        { kind: "when", variable: "受伤", value: -2, skill: "力量" },
        { kind: "when", variable: "天气", equals: "雨", value: -1 },
        { kind: "when", variable: "层数", equals: 3, value: 1, skill: "理智" },
        { kind: "perStep", resource: "恐惧", step: 25, value: -1, skill: "理智" },
      ],
    };
    const c = new Compiler('VAR 受伤 = 1\nVAR 天气 = "雨"\nVAR 层数 = 3\nVAR 恐惧 = 30\nx\n-> END'); // 受伤 as an int 1, as an ink function would return
    const story = new Story(c.Compile().ToJson() as string);
    const state = (name: string) => story.variablesState[name];
    expect(collectModifiers(config, "力量", state)).toEqual([{ source: "受伤", value: -2 }, { source: "天气", value: -1 }]);
    expect(collectModifiers(config, "理智", state)).toEqual([{ source: "天气", value: -1 }, { source: "层数", value: 1 }, { source: "恐惧", value: -1 }]);
  });
});

describe("validateConfig", () => {
  test("accepts the sample config", () => {
    expect(validateConfig(CONFIG)).toEqual([]);
  });
  test("reports duplicate ids, bad identifiers, unknown skills in presets", () => {
    const bad: GameConfig = {
      ...CONFIG,
      skills: [{ id: "理智" }, { id: "理智" }, { id: "bad name" }],
      characters: [{ id: "昕", skills: { 歌唱: 3 } }],
    };
    const problems = validateConfig(bad);
    expect(problems.some((p) => p.includes("理智"))).toBe(true);
    expect(problems.some((p) => p.includes("bad name"))).toBe(true);
    expect(problems.some((p) => p.includes("歌唱"))).toBe(true);
  });
  test("reports a non-positive step, no characters, and duplicate companion resource ids", () => {
    const bad: GameConfig = {
      ...CONFIG,
      characters: [],
      companionResources: [{ id: "恐惧", min: 0, max: 100, initial: 0 }, { id: "恐惧", min: 0, max: 100, initial: 0 }],
      modifiers: [{ kind: "perStep", resource: "恐惧", step: 0, value: -1 }],
    };
    const problems = validateConfig(bad);
    expect(problems.some((p) => p.includes("step"))).toBe(true);
    expect(problems.some((p) => p.includes("character"))).toBe(true);
    expect(problems.some((p) => p.includes("duplicate") && p.includes("恐惧"))).toBe(true);
  });
  test("reports ids colliding with ink names, generated companion variables, bad resource ranges and difficulties", () => {
    const bad: GameConfig = {
      ...CONFIG,
      difficulties: { 普通: 0 },
      skills: [{ id: "检定" }, { id: "恐惧_昕" }],
      resources: [{ id: "体力", min: 0, max: 10, initial: 11 }],
      characters: [{ id: "昕", skills: {} }],
    };
    const problems = validateConfig(bad);
    expect(problems.some((p) => p.includes('duplicate id "检定"'))).toBe(true);
    expect(problems.some((p) => p.includes('duplicate id "恐惧_昕"'))).toBe(true);
    expect(problems.some((p) => p.includes("体力"))).toBe(true);
    expect(problems.some((p) => p.includes("普通"))).toBe(true);
  });
  test("rejects dice with no faces", () => {
    expect(validateConfig({ ...CONFIG, rules: { kind: "sum", dice: [] } }).some((p) => p.includes("dice"))).toBe(true);
    expect(validateConfig({ ...CONFIG, rules: { kind: "rollUnder", sides: 1 } }).some((p) => p.includes("sides"))).toBe(true);
  });
  test("skill ids may not reuse the generated function parameter names", () => {
    const problems = validateConfig({ ...CONFIG, skills: [{ id: "技能" }], characters: [{ id: "昕", skills: {} }] });
    expect(problems.some((p) => p.includes('"技能"'))).toBe(true);
  });
});

describe("generated ink", () => {
  test("declares skills, resources, characters and companions, and compiles", () => {
    const ink = generateInk(CONFIG);
    expect(ink).toContain("VAR 理智 = 0");
    expect(ink).toContain("VAR 恐惧 = 0");
    expect(ink).toContain("LIST 主角 = 昕, 阿波");
    expect(ink).toContain("VAR 恐惧_阿波 = 10");
    expect(ink).toContain("VAR 信任_阿波 = 60");
    expect(ink).toContain("EXTERNAL 检定(技能, 难度)");
    expect(ink).toContain("VAR 骰子种子 = 0");
    expect(ink).toContain("VAR 掷骰次数 = 0");
    const c = new Compiler("-> main\n" + ink + "\n=== main ===\n~ 选主角(阿波)\n{检定(\"力量\", 10)} {检定(\"力量\", 14)} {检定(\"没有\", 8)}\n-> END\n");
    const story = new Story(c.Compile().ToJson() as string);
    story.allowExternalFunctionFallbacks = true;
    let out = "";
    while (story.canContinue) out += story.Continue();
    // The fallback uses the average roll (7): 5 + 7 = 12 >= 10 succeeds, < 14 fails.
    expect(out.trim()).toBe("3 1 1"); // an unknown skill counts as level 0
    expect(story.variablesState["力量"]).toBe(5);
    expect(story.variablesState["魅力"]).toBe(2);
    expect(String(story.variablesState["当前主角"])).toBe("阿波");
  });
});
