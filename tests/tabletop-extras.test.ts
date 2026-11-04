import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { compileStory } from "../src/compile/compile";
import { readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { exploreStory } from "../src/play/explore";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

describe("rounds and phases", () => {
  const TURN: GameConfig = { ...CONFIG, turn: { round: "回合", phase: "阶段", phases: [{ id: "整备", name: { zh: "整备", en: "Upkeep" } }, { id: "敌人", name: { zh: "敌人阶段", en: "Enemy phase" } }] } };

  test("the config reads them; their variables are in the namespace; phases are needed", () => {
    const fm = { rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], turn: { round: "round", phase: "phase", phases: [{ id: "upkeep" }, { id: "enemy", name: { zh: "敌人", en: "Enemy" } }] } };
    const { config, problems } = readConfig(fm);
    expect(problems).toEqual([]);
    expect(config?.turn).toEqual({ round: "round", phase: "phase", phases: [{ id: "upkeep" }, { id: "enemy", name: { zh: "敌人", en: "Enemy" } }] });
    expect(readConfig({ ...fm, turn: { round: "round" } }).problems).toEqual([{ code: "shape", args: ["turn"] }]);
    expect(validateConfig({ ...TURN, turn: { ...TURN.turn!, round: "力量" } })).toContainEqual({ code: "duplicate", args: ["力量"] });
    expect(validateConfig({ ...TURN, turn: { ...TURN.turn!, phases: [] } })).toContainEqual({ code: "list", args: ["turn.phases"] });
  });

  test("the generated ink declares them; the HUD reads the round and names the phase", () => {
    const ink = generateInk(TURN);
    expect(ink).toContain("VAR 回合 = 1");
    expect(ink).toContain('VAR 阶段 = "整备"');
    const engine = new GameEngine(TURN);
    const s = new PlaySession(new Compiler(`-> main\n${ink}\n=== main ===\n~ 回合 = 3\n~ 阶段 = "敌人"\n门。\n-> END\n`).Compile(), { setup: (st) => engine.setup(st, "昕") });
    s.start();
    expect(engine.hud().turn).toEqual({ round: 3, phase: "敌人阶段" });
    engine.language = "en";
    expect(engine.hud().turn).toEqual({ round: 3, phase: "Enemy phase" });
  });
});

describe("#use: the player picks something carried", () => {
  // CONFIG has items 手机 and 刀; 昕 starts with the phone.
  const STORY = `-> main
${generateInk(CONFIG)}
=== main ===
~ 背包 += 刀
门锁着。
+ [用点什么 #use]
    { 出牌 == 刀: 你用刀撬开了门。}
    { 出牌 == 手机: 你用手机照了照锁。}
    -> END
+ [走开] -> END
`;

  test("a game with items but no hands still gets the played VAR", () => {
    expect(generateInk(CONFIG)).toContain("VAR 出牌 = ()");
  });

  test("a #use choice offers what is carried, and is taken with one of them", () => {
    const engine = new GameEngine(CONFIG);
    const s = new PlaySession(new Compiler(STORY).Compile(), { setup: (st) => engine.setup(st, "昕") });
    const step = s.start();
    const use = engine.playOf(step.choices[0]);
    expect(use).toMatchObject({ hand: "背包", use: true, known: true });
    expect(use?.cards.map((c) => c.id)).toEqual(["手机", "刀"]);
    expect(engine.canChoose(step.choices[0])).toBe(true);
    expect(engine.playPayload("背包", "刀")).toEqual({ var: "出牌", item: "刀" });
    expect(engine.playPayload("背包", "钥匙")).toBeNull();
    expect(s.choose(0, engine.playPayload("背包", "刀")!).paragraphs.map((p) => p.text)).toEqual(["你用刀撬开了门。"]);
  });

  test("with nothing carried the choice is locked; the explorer tries each thing carried", async () => {
    const engine = new GameEngine(CONFIG);
    const empty = new PlaySession(new Compiler(STORY.replace("~ 背包 += 刀\n", "~ 背包 = ()\n")).Compile(), { setup: (st) => engine.setup(st, "昕") });
    const step = empty.start();
    expect(engine.canChoose(step.choices[0])).toBe(false);
    const r = await compileStory("main.ink", async () => STORY);
    const x = exploreStory(r.story!, { game: CONFIG, character: "昕" });
    expect(x.endings.map((e) => e.choices.join(" > ")).sort()).toEqual(["用点什么 ▸ 刀", "用点什么 ▸ 手机", "走开"]);
  });
});
