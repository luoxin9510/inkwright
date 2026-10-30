import { describe, expect, test } from "vitest";
import { Compiler, Story } from "inkjs/full";
import { collectModifiers, fxOf, inkNames, localize, parseCheckTag, parseFxTag, parseVoiceTag, playableCharacters, readConfig, validateConfig, type ConfigProblem, type GameConfig } from "../src/game/config";
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

const codes = (problems: ConfigProblem[]) => problems.map((p) => `${p.code}:${p.args.join(",")}`);

describe("validateConfig", () => {
  test("accepts the sample config", () => {
    expect(validateConfig(CONFIG)).toEqual([]);
  });
  test("reports duplicate ids, bad identifiers, unknown skills in presets", () => {
    const bad: GameConfig = {
      ...CONFIG,
      skills: [{ id: "理智" }, { id: "理智" }, { id: "bad name" }],
      characters: [{ id: "昕", skills: { 歌唱: 3, 理智: 9 } }],
      modifiers: [],
    };
    expect(codes(validateConfig(bad))).toEqual(["duplicate:理智", "ident:bad name", "unknownSkill:昕,歌唱", "skillLevel:昕,理智,9,6"]);
  });
  test("reports a non-positive step, no characters, and duplicate companion resource ids", () => {
    const bad: GameConfig = {
      ...CONFIG,
      characters: [],
      companionResources: [{ id: "恐惧", min: 0, max: 100, initial: 0 }, { id: "恐惧", min: 0, max: 100, initial: 0 }],
      modifiers: [{ kind: "perStep", resource: "恐惧", step: 0, value: -1, skill: "歌唱" }],
    };
    expect(codes(validateConfig(bad))).toEqual(["duplicate:恐惧", "noCharacters:", "modifierSkill:歌唱", "modifierStep:恐惧"]);
  });
  test("reports ids colliding with ink names, generated companion variables, bad resource ranges and difficulties", () => {
    const bad: GameConfig = {
      ...CONFIG,
      difficulties: { 普通: 0 },
      skills: [{ id: "检定" }, { id: "恐惧_昕" }],
      resources: [{ id: "体力", min: 0, max: 10, initial: 11 }],
      characters: [{ id: "昕", skills: {}, companion: { 士气: 1 } }],
      modifiers: [],
    };
    expect(codes(validateConfig(bad))).toEqual(["duplicate:恐惧_昕", "duplicate:检定", "resourceRange:体力", "difficulty:普通", "unknownCompanionResource:昕,士气"]);
  });
  test("rejects dice with no faces", () => {
    expect(codes(validateConfig({ ...CONFIG, rules: { kind: "sum", dice: [] } }))).toEqual(["dice:"]);
    expect(codes(validateConfig({ ...CONFIG, rules: { kind: "rollUnder", sides: 1 } }))).toEqual(["sides:"]);
  });
  test("skill ids may not reuse the generated function parameter names", () => {
    const problems = validateConfig({ ...CONFIG, skills: [{ id: "技能" }], characters: [{ id: "昕", skills: {} }], modifiers: [] });
    expect(codes(problems)).toEqual(["duplicate:技能"]);
  });
});

describe("localized text and ink name presets", () => {
  test("localize picks the language, then the first given, then the fallback", () => {
    expect(localize("洞察力", "en", "insight")).toBe("洞察力");
    expect(localize({ zh: "洞察力", en: "Insight" }, "en", "insight")).toBe("Insight");
    expect(localize({ zh: "洞察力" }, "en", "insight")).toBe("洞察力");
    expect(localize({}, "en", "insight")).toBe("insight");
    expect(localize(undefined, "zh", "insight")).toBe("insight");
  });
  test("English names are the default; 'zh' is a preset; overrides apply to the English defaults", () => {
    expect(inkNames({ ...CONFIG, ink: undefined }).check).toBe("check");
    expect(inkNames({ ...CONFIG, ink: "en" }).select).toBe("pick_character");
    expect(inkNames(CONFIG)).toMatchObject({ check: "检定", langVar: "语言", textFn: "双" });
    expect(inkNames({ ...CONFIG, ink: { check: "roll" } })).toMatchObject({ check: "roll", select: "pick_character" });
  });
  test("languages must be two different codes", () => {
    expect(codes(validateConfig({ ...CONFIG, languages: ["zh"] }))).toEqual(["languages:"]);
    expect(codes(validateConfig({ ...CONFIG, languages: ["zh", "zh"] }))).toEqual(["languages:"]);
    expect(codes(validateConfig({ ...CONFIG, languages: ["zh", "en-US"] }))).toEqual(["languages:"]);
    expect(validateConfig({ ...CONFIG, languages: undefined })).toEqual([]);
  });
});

describe("readConfig (frontmatter of unknown shape)", () => {
  test("reads the sample config back, filling in the optional lists", () => {
    const { config, problems } = readConfig(JSON.parse(JSON.stringify(CONFIG)));
    expect(problems).toEqual([]);
    expect(config).toEqual({ ...CONFIG, difficulties: CONFIG.difficulties, resources: CONFIG.resources, companionResources: CONFIG.companionResources ?? [], modifiers: CONFIG.modifiers ?? [], ink: CONFIG.ink });
  });
  test("empty YAML values count as absent", () => {
    const { config, problems } = readConfig({
      rules: { kind: "sum", dice: [6, 6], partialBelow: null },
      skills: [{ id: "理智", name: null, voice: null }],
      characters: [{ id: "昕", skills: null }],
      resources: null, modifiers: null, difficulties: null, ink: null,
    });
    expect(problems).toEqual([]);
    expect(config?.characters[0].skills).toEqual({});
    expect(config?.resources).toEqual([]);
  });
  test("no frontmatter or no usable rules", () => {
    expect(codes(readConfig(undefined).problems)).toEqual(["noFrontmatter:"]);
    expect(codes(readConfig("---").problems)).toEqual(["noFrontmatter:"]);
    expect(codes(readConfig({ skills: [{ id: "a" }], characters: [{ id: "b" }] }).problems)).toEqual(["rulesKind:"]);
    expect(codes(readConfig({ rules: "2d6", skills: [{ id: "a" }], characters: [{ id: "b" }] }).problems)).toEqual(["rulesKind:"]);
  });
  test("every wrong shape is named by its path, without throwing", () => {
    const { config, problems } = readConfig({
      rules: { kind: "sum", dice: "6+6", naturalCrits: "yes" },
      difficulties: [10, 12],
      ink: { check: 1 },
      skills: [{ id: "理智" }, "耐力", { id: "魅力", max: "six" }],
      resources: [{ id: "恐惧", min: 0, max: "100" }],
      companionResources: { id: "信任" },
      characters: [{ id: "昕", skills: { 理智: "3" } }, { name: "无名" }],
      modifiers: [{ kind: "perStep", resource: "恐惧" }, { kind: "when", variable: "受伤", value: -1 }, { kind: "always", value: 1 }],
    });
    expect(config).toBeNull();
    expect(codes(problems)).toEqual([
      "shape:rules.dice", "shape:rules.naturalCrits", "shape:difficulties", "shape:ink", "shape:skills[1]", "shape:skills[2]",
      "shape:resources[0]", "shape:companionResources", "shape:characters[0]", "shape:characters[1]", "shape:modifiers[0]", "shape:modifiers[2]",
    ]);
  });
  test("required lists must be present and non-empty", () => {
    expect(codes(readConfig({ rules: { kind: "rollUnder", sides: 100 }, skills: [], characters: "昕" }).problems)).toEqual(["list:skills", "list:characters"]);
    expect(codes(readConfig({ rules: { kind: "rollUnder", sides: "d100" } }).problems)).toEqual(["shape:rules.sides", "list:skills", "list:characters"]);
  });
  test("ink preset, languages, engine file and localized names", () => {
    const base = { rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "insight", name: { zh: "洞察力", en: "Insight" }, voice: { stance: { zh: "看。", en: "Look." } } }], characters: [{ id: "xin", name: "昕" }] };
    const ok = readConfig({ ...base, ink: "zh", languages: ["zh", "en"], engineFile: "_rules.ink" });
    expect(ok.problems).toEqual([]);
    expect(ok.config).toMatchObject({ ink: "zh", languages: ["zh", "en"], engineFile: "_rules.ink" });
    expect(codes(readConfig({ ...base, ink: "fr" }).problems)).toEqual(["shape:ink"]);
    expect(codes(readConfig({ ...base, languages: "zh,en" }).problems)).toEqual(["shape:languages"]);
    expect(codes(readConfig({ ...base, engineFile: "rules/_engine.ink" }).problems)).toEqual(["shape:engineFile"]);
    expect(codes(readConfig({ ...base, skills: [{ id: "insight", name: { zh: 1 } }] }).problems)).toEqual(["shape:skills[0]"]);
  });
  test("a well-formed config still gets the rule checks", () => {
    const { config, problems } = readConfig({ rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "理智" }], characters: [{ id: "昕", skills: { 理智: 7 } }] });
    expect(config).not.toBeNull();
    expect(codes(problems)).toEqual(["skillLevel:昕,理智,7,6"]);
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
    expect(ink).toContain('VAR 语言 = "zh"');
    expect(ink).toContain("=== function 双(zh, en) ===");
    const c = new Compiler("-> main\n" + ink + "\n=== main ===\n~ 选主角(\"阿波\")\n{检定(\"力量\", 10)} {检定(\"力量\", 14)} {检定(\"没有\", 8)}\n-> END\n");
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

describe("generated ink with the English names (the default)", () => {
  test("declares the engine in English and the bilingual text function", () => {
    const ink = generateInk({ ...CONFIG, ink: undefined });
    expect(ink).toContain("EXTERNAL check(skill, difficulty)");
    expect(ink).toContain("=== function pick_character(who) ===");
    expect(ink).toContain("VAR dice_seed = 0");
    expect(ink).toContain('VAR lang = "zh"');
    const c = new Compiler("-> main\n" + ink + "\n=== main ===\n~ pick_character(\"阿波\")\n{t(\"你好\", \"hi\")} {check(\"力量\", 10)}\n~ lang = \"en\"\n{t(\"你好\", \"hi\")}\n-> END\n");
    const s = new Story(c.Compile().ToJson() as string);
    s.allowExternalFunctionFallbacks = true;
    let out = ""; while (s.canContinue) out += s.Continue();
    expect(out.trim().split(/\s+/)).toEqual(["你好", "3", "hi"]);
  });
  test("a story without languages gets no text function", () => {
    expect(generateInk({ ...CONFIG, ink: undefined, languages: undefined })).not.toContain("function t(");
  });
});

describe("playable", () => {
  test("companions marked playable: false are read but kept out of the pick list; one playable character is required", () => {
    const fm = () => JSON.parse(JSON.stringify(CONFIG)) as Record<string, unknown>;
    const { config, problems } = readConfig({ ...fm(), characters: [{ id: "昕", skills: {}, playable: false }, { id: "阿波", skills: {} }] });
    expect(problems).toEqual([]);
    expect(playableCharacters(config as GameConfig).map((c) => c.id)).toEqual(["阿波"]);
    expect(codes(validateConfig({ ...CONFIG, characters: [{ id: "昕", skills: {}, playable: false }] }))).toEqual(["noCharacters:"]);
    expect(codes(readConfig({ ...fm(), characters: [{ id: "昕", playable: "no" }] }).problems)).toEqual(["shape:characters[0]"]);
  });
});

test("fx tags name a screen effect from the fixed list; anything else is not an effect", () => {
  expect(parseFxTag("fx:shake")).toBe("shake");
  expect(parseFxTag(" fx : dark ")).toBe("dark");
  expect(parseFxTag("fx:boom")).toBeNull();
  expect(parseFxTag("voice:理智")).toBeNull();
  expect(fxOf(["voice:理智", "fx:flash", "fx:pulse"])).toEqual(["flash", "pulse"]);
});
