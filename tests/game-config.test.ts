import { describe, expect, test } from "vitest";
import { Compiler, Story } from "inkjs/full";
import { collectModifiers, parseCheckTag, parseVoiceTag, validateConfig, type GameConfig } from "../src/game/config";
import { generateInk } from "../src/game/inkgen";

export const CONFIG: GameConfig = {
  rules: { kind: "sum", dice: [6, 6] },
  difficulties: { 轻松: 6, 简单: 8, 普通: 10, 困难: 12, 艰难: 14, 传奇: 16 },
  skills: [
    { id: "理智", voice: { stance: "这说得通,撑住。", color: "#7a9cff" } },
    { id: "耐力" }, { id: "魅力" }, { id: "洞察力" }, { id: "力量" },
  ],
  resources: [{ id: "恐惧", min: 0, max: 100, initial: 0 }],
  companionResources: [{ id: "恐惧", min: 0, max: 100, initial: 20 }, { id: "信任", min: 0, max: 100, initial: 50 }],
  characters: [
    { id: "昕", skills: { 理智: 3, 耐力: 3, 魅力: 6, 洞察力: 3, 力量: 2 } },
    { id: "阿波", skills: { 理智: 4, 耐力: 3, 魅力: 2, 洞察力: 3, 力量: 5 }, companion: { 恐惧: 10, 信任: 60 } },
  ],
  modifiers: [
    { kind: "perStep", resource: "恐惧", step: 25, value: -1, skill: "理智", label: "恐惧" },
    { kind: "when", variable: "受伤", equals: true, value: -2, skill: "力量", label: "受伤" },
  ],
};

describe("tags", () => {
  test("check tags: skill, difficulty (number or ladder name), red", () => {
    expect(parseCheckTag("check:力量:12", CONFIG)).toEqual({ skill: "力量", difficulty: 12, red: false });
    expect(parseCheckTag("check:理智:困难:红", CONFIG)).toEqual({ skill: "理智", difficulty: 12, red: true });
    expect(parseCheckTag("check:理智:hard:red", CONFIG)).toBeNull(); // unknown ladder name
    expect(parseCheckTag("check:歌唱:10", CONFIG)).toBeNull(); // unknown skill
    expect(parseCheckTag("voice:理智", CONFIG)).toBeNull();
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
    const c = new Compiler("-> main\n" + ink + "\n=== main ===\n~ 选主角(阿波)\n{检定(力量, 10)} {检定(力量, 14)}\n-> END\n");
    const story = new Story(c.Compile().ToJson() as string);
    story.allowExternalFunctionFallbacks = true;
    let out = "";
    while (story.canContinue) out += story.Continue();
    // The fallback uses the average roll (7): 5 + 7 = 12 >= 10 succeeds, < 14 fails.
    expect(out.trim()).toBe("3 1");
    expect(story.variablesState["力量"]).toBe(5);
    expect(story.variablesState["魅力"]).toBe(2);
    expect(String(story.variablesState["当前主角"])).toBe("阿波");
  });
});
