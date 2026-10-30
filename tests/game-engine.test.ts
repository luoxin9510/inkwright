import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

const STORY = `-> main
${generateInk(CONFIG)}
=== main ===
走廊尽头的门虚掩着。
{洞察力 >= 3: 门缝里的黑不是没开灯的黑。 #voice:洞察力}
+ [撬开门 #check:力量:10]
    { 检定("力量", 10) >= 3: 锁开了。|撬棍断了。 }
    ~ 恐惧 += 30
    -> main
+ [最后一搏 #check:力量:困难:红]
    -> END
+ [走开]
    -> END
`;

function compile() {
  return new Compiler(STORY).Compile();
}

/** rng that makes 2d6 show the given faces, then repeats the last one. */
const faces = (...fs: number[]) => {
  let i = 0;
  return () => (fs[Math.min(i++, fs.length - 1)] - 1) / 6 + 1e-9;
};

describe("GameEngine with a PlaySession", () => {
  test("loads the character preset, describes check choices and rolls through the EXTERNAL function", () => {
    const engine = new GameEngine(CONFIG, { rng: faces(3, 4) });
    const session = new PlaySession(compile(), { setup: (story) => engine.setup(story, "阿波") });
    const step = session.start();
    expect(engine.character()).toBe("阿波");
    // 阿波 has 洞察力 3, so the passive voice line shows, tagged for the voice.
    expect(step.paragraphs.map((p) => p.text)).toEqual(["走廊尽头的门虚掩着。", "门缝里的黑不是没开灯的黑。"]);
    expect(engine.voiceOf(step.paragraphs[1])).toBe("洞察力");
    expect(engine.voiceOf(step.paragraphs[0])).toBeNull();

    const checks = step.choices.map((c) => engine.describeChoice(c));
    expect(checks[0]).toMatchObject({ skill: "力量", difficulty: 10, red: false, modifiers: [] });
    // 力量 5 needs 5+ on 2d6: 30/36
    expect(checks[0]?.chance.success).toBeCloseTo(30 / 36, 6);
    expect(checks[1]).toMatchObject({ skill: "力量", difficulty: 12, red: true });
    expect(checks[2]).toBeNull();

    const after = session.choose(0);
    expect(after.paragraphs[0].text).toBe("锁开了。"); // 3 + 4 + 5 = 12 >= 10
    expect(engine.rolls).toHaveLength(1);
    expect(engine.rolls[0]).toMatchObject({ skill: "力量", difficulty: 10, rolls: [3, 4], total: 12, band: 3, turn: 0 });
    expect(engine.rolls[0].chance.success).toBeCloseTo(30 / 36, 6);
  });

  test("modifiers from the story state change the odds and the roll", () => {
    const engine = new GameEngine(CONFIG, { rng: faces(3, 4) });
    const session = new PlaySession(compile(), { setup: (story) => engine.setup(story, "昕") });
    let step = session.start();
    step = session.choose(0); // fear becomes 30
    expect(engine.hud().resources).toEqual([{ id: "恐惧", name: "恐惧", value: 30, min: 0, max: 100 }]);
    // 理智 is penalized by fear, 力量 is not: find the 理智 effect by describing a synthetic choice.
    expect(engine.describeChoice({ tags: ["check:理智:10"] })?.modifiers).toEqual([{ source: "恐惧", value: -1 }]);
    expect(engine.describeChoice(step.choices[0])?.modifiers).toEqual([]);
  });

  test("two skills at the same level are told apart, because the story passes the name", () => {
    // 昕 has 理智 3 and 洞察力 3; the roll must be logged as 洞察力 with its own modifiers.
    const engine = new GameEngine(CONFIG, { rng: faces(3, 4) });
    const src = STORY.replace('检定("力量", 10)', '检定("洞察力", 10)');
    const session = new PlaySession(new Compiler(src).Compile(), { setup: (story) => engine.setup(story, "昕") });
    session.start();
    session.choose(0);
    expect(engine.rolls[0]).toMatchObject({ skill: "洞察力", level: 3, total: 10, band: 3 });
  });

  test("hud names follow the engine's language; the id is the fallback", () => {
    const engine = new GameEngine(CONFIG);
    const session = new PlaySession(compile(), { setup: (story) => engine.setup(story, "昕") });
    session.start();
    expect(engine.hud().character?.skills[0]).toEqual({ id: "理智", name: "理智", level: 3 });
    engine.language = "en";
    expect(engine.hud().character?.skills[0]).toEqual({ id: "理智", name: "Reason", level: 3 });
    expect(engine.hud().character?.skills[1]).toEqual({ id: "耐力", name: "耐力", level: 3 });
  });

  test("hud lists the other characters as companions with their resources", () => {
    const engine = new GameEngine(CONFIG);
    const session = new PlaySession(compile(), { setup: (story) => engine.setup(story, "昕") });
    session.start();
    expect(engine.hud().companions).toEqual([
      { id: "阿波", name: "阿波", resources: [{ id: "恐惧", name: "恐惧", value: 10, min: 0, max: 100 }, { id: "信任", name: "信任", value: 60, min: 0, max: 100 }] },
    ]);
    expect(engine.hud().character).toEqual({ id: "昕", name: "昕", skills: [{ id: "理智", name: "理智", level: 3 }, { id: "耐力", name: "耐力", level: 3 }, { id: "魅力", name: "魅力", level: 6 }, { id: "洞察力", name: "洞察力", level: 3 }, { id: "力量", name: "力量", level: 2 }] });
  });

  test("the setup hook runs again on restart, so the preset survives and the binding stays", () => {
    const engine = new GameEngine(CONFIG, { rng: faces(6, 6) });
    const session = new PlaySession(compile(), { setup: (story) => engine.setup(story, "阿波") });
    session.start();
    session.choose(0);
    const step = session.restart();
    expect(engine.character()).toBe("阿波");
    expect(step.choices.length).toBe(3);
    session.choose(0);
    expect(engine.rolls.at(-1)?.band).toBe(4);
  });

  test("replaying the run in another language rolls the same dice and keeps one record per check", () => {
    const engine = new GameEngine(CONFIG);
    const session = new PlaySession(compile(), { setup: (story) => engine.setup(story, "阿波") });
    session.start();
    const outcome = session.choose(0).paragraphs[0].text;
    const first = engine.rolls[0];
    expect(first.index).toBe(0);
    session.setLanguage("en");
    expect(engine.rolls).toEqual([first]);
    expect(session.log[2].text).toBe(outcome);
  });

  test("back and the same choice again rolls the same dice; the undone roll leaves the log", () => {
    const engine = new GameEngine(CONFIG);
    const session = new PlaySession(compile(), { setup: (story) => engine.setup(story, "阿波") });
    session.start();
    const outcome = session.choose(0).paragraphs[0].text;
    const first = engine.rolls[0];
    session.back();
    expect(engine.rolls).toEqual([]);
    expect(session.choose(0).paragraphs[0].text).toBe(outcome);
    expect(engine.rolls).toEqual([first]);
    session.choose(0);
    expect(engine.rolls.map((r) => r.index)).toEqual([0, 1]);
  });

  test("a save carries the dice: another session replays the same rolls from it", () => {
    const a = new GameEngine(CONFIG);
    const sa = new PlaySession(compile(), { setup: (story) => a.setup(story, "阿波") });
    sa.start();
    sa.choose(0);
    const save = sa.save();
    if (!save) throw new Error("no save");
    const b = new GameEngine(CONFIG);
    const sb = new PlaySession(compile(), { setup: (story) => b.setup(story, "昕") });
    sb.start();
    sb.choose(0); // b's own run, with its own dice
    sb.load(save);
    expect(b.rolls).toEqual([]); // that roll belongs to another run
    sb.setLanguage("en");
    expect(b.rolls).toEqual(a.rolls);
    expect(b.character()).toBe("阿波");
  });

  test("a skill the config does not know is rolled at level 0 and flagged, so typos show in the log", () => {
    const engine = new GameEngine(CONFIG, { rng: faces(3, 4) });
    const src = STORY.replace('检定("力量", 10)', '检定("力气", 10)');
    const session = new PlaySession(new Compiler(src).Compile(), { setup: (story) => engine.setup(story, "阿波") });
    session.start();
    session.choose(0);
    expect(engine.rolls[0]).toMatchObject({ skill: "力气", level: 0, modifiers: [], total: 7, band: 1, unknown: true });
    expect(engine.rolls[0]).not.toHaveProperty("unknown", undefined);
  });

  test("a forced band skips the dice (for walking every outcome)", () => {
    const engine = new GameEngine(CONFIG, { force: () => 1 });
    const session = new PlaySession(compile(), { setup: (story) => engine.setup(story, "阿波") });
    session.start();
    const step = session.choose(0);
    expect(step.paragraphs[0].text).toBe("撬棍断了。");
    expect(engine.rolls[0].rolls).toEqual([]);
  });
});

test("start picks the first playable character; companions marked playable: false are never played", () => {
  const config = { ...CONFIG, characters: [{ ...CONFIG.characters[0], playable: false }, CONFIG.characters[1]] };
  const engine = new GameEngine(config, { rng: faces(3, 4) });
  const session = new PlaySession(compile(), { setup: (story) => engine.setup(story) });
  session.start();
  expect(engine.character()).toBe("阿波");
  expect(engine.hud().companions.map((c) => c.id)).toEqual(["昕"]);
});
