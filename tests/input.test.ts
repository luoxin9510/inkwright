import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { compileStory } from "../src/compile/compile";
import { inputOf, inputPayload, inputPlaceholder } from "../src/play/input";
import { exploreStory } from "../src/play/explore";
import { playScript } from "../src/play/script";
import { PlaySession } from "../src/play/session";
import { simulateStory } from "../src/play/simulate";

/** A plain story (no game note): the player names the cat, then the story reads the name back. */
const STORY = `VAR lang = "zh"
VAR cat = "猫"
你捡到一只猫。
+ [{lang == "zh": 给它起名|Name it} #input:cat]
    { lang == "zh": 你叫它{cat}。|You call it {cat}. }
    -> END
+ [{lang == "zh": 不起名|Leave it}]
    它走了。
    -> END
`;

const typed = (text: string) => ({ var: "cat", text });

describe("#input", () => {
  test("the tag names the variable the typed text goes into", () => {
    expect(inputOf({ tags: ["input:cat"] })).toBe("cat");
    expect(inputOf({ tags: ["check:wits:8", " input : 名字 "] })).toBe("名字");
    expect(inputOf({ tags: ["input:"] })).toBeNull();
    expect(inputOf({ tags: ["input"] })).toBeNull();
    expect(inputOf({ tags: ["input:a:b"] })).toBeNull();
    expect(inputOf({ tags: [] })).toBeNull();
  });

  test("the payload trims the text; nothing typed is no payload", () => {
    expect(inputPayload("cat", "  煤球 ")).toEqual(typed("煤球"));
    expect(inputPayload("cat", "   ")).toBeNull();
    expect(inputPlaceholder("cat")).toBe("[cat]");
  });

  test("the session writes the text before the choice runs, and keeps it through back, save and the language replay", () => {
    const session = new PlaySession(new Compiler(STORY).Compile());
    session.start();
    let step = session.choose(0, typed("煤球"));
    expect(step.paragraphs.map((p) => p.text)).toEqual(["你叫它煤球。"]);
    expect(session.lastChoice).toEqual({ text: "给它起名", at: 1, payload: typed("煤球") });
    const save = session.save();
    expect(save?.picks).toEqual([{ index: 0, payload: typed("煤球") }]);
    session.back();
    expect(session.read("cat")).toBe("猫");
    const loaded = new PlaySession(new Compiler(STORY).Compile());
    loaded.start();
    loaded.load(save!);
    expect(loaded.setLanguage("en").choices).toEqual([]);
    expect(loaded.log.map((p) => p.text)).toEqual(["你捡到一只猫。", "You call it 煤球."]);
  });

  test("text for a variable the story does not declare is an error and leaves the state as it was", () => {
    const session = new PlaySession(new Compiler(STORY).Compile());
    session.start();
    const step = session.choose(0, { var: "dog", text: "旺财" });
    expect(step.errors).toHaveLength(1);
    expect(session.canGoBack).toBe(false);
    expect(step.choices.map((c) => c.text)).toEqual(["给它起名", "不起名"]);
  });

  test("headless play types the given text, else the placeholder", () => {
    const story = () => new Compiler(STORY).Compile();
    const named = playScript(story(), { choices: [{ choice: "起名", text: "煤球" }] });
    expect(named.errors).toEqual([]);
    expect(named.transcript).toContainEqual({ type: "choice", index: 0, text: "给它起名", input: "煤球" });
    expect(named.transcript.at(-1)).toMatchObject({ type: "text", text: "你叫它煤球。" });
    const plain = playScript(story(), { choices: [0] });
    expect(plain.transcript.at(-1)).toMatchObject({ type: "text", text: "你叫它[cat]。" });
  });

  test("the explorer and the random player type the placeholder", async () => {
    const r = await compileStory("main.ink", async () => STORY);
    const x = exploreStory(r.story!, {});
    expect(x.errors).toEqual([]);
    expect(x.endings.map((e) => [e.choices.join(" > "), e.lastText])).toEqual([
      ["给它起名 ▸ [cat]", "你叫它[cat]。"],
      ["不起名", "它走了。"],
    ]);
    const s = simulateStory(r.story!, { runs: 10, seed: 1 });
    expect(s.errors).toEqual([]);
    expect(s.endings.map((e) => e.lastText).sort()).toEqual(["你叫它[cat]。", "它走了。"]);
  });
});
