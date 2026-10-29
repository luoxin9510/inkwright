import { describe, expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { PlaySession } from "../src/play/session";

const BILINGUAL = [
  'VAR 语言 = "zh"',
  "VAR gold = 0",
  '{双("开始。", "Start.")}',
  "- (hub)",
  '+ [{双("挖", "Dig")}] {双("挖到了。", "Dug.")}',
  "  ~ gold += 1",
  "  -> hub",
  '+ [{双("离开", "Leave")}] Bye.',
  "  -> END",
  "=== function 双(zh, en) ===",
  '{ 语言 == "en":',
  "  ~ return en",
  "}",
  "~ return zh",
].join("\n");

async function session(src = BILINGUAL, options = {}) {
  const r = await compileStory("main.ink", async () => src);
  if (!r.story) throw new Error(JSON.stringify(r.diagnostics));
  return new PlaySession(r.story, options);
}
const texts = (s: PlaySession) => s.log.map((p) => p.text);
const gold = (s: PlaySession) => s.inspect().variables.find((v) => v.name === "gold")!.value;

describe("story language", () => {
  test("a story without a language variable has no language", async () => {
    const s = await session("Hi.\n-> END");
    s.start();
    expect(s.languageVar).toBeNull();
    expect(s.language).toBeNull();
  });

  test("the 语言 (or lang) variable is detected and read", async () => {
    const s = await session();
    s.start();
    expect(s.languageVar).toBe("语言");
    expect(s.language).toBe("zh");
    const t = await session('VAR lang = "en"\nHi.\n-> END');
    expect(t.languageVar).toBe("lang");
  });

  test("switching replays the run so far in the new language, keeping progress", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    s.choose(0);
    const step = s.setLanguage("en");
    expect(s.language).toBe("en");
    expect(texts(s)).toEqual(["Start.", "Dug.", "Dug."]);
    expect(step.choices.map((c) => c.text)).toEqual(["Dig", "Leave"]);
    expect(gold(s)).toBe("2");
    // Undo still works after the replay.
    s.back();
    expect(texts(s)).toEqual(["Start.", "Dug."]);
  });

  test("the chosen language survives restart and startAt", async () => {
    const s = await session();
    s.start();
    s.setLanguage("en");
    const step = s.restart();
    expect(step.paragraphs.map((p) => p.text)).toEqual(["Start."]);
    expect(step.choices.map((c) => c.text)).toEqual(["Dig", "Leave"]);
    const t = await session(BILINGUAL + "\n=== side ===\n{双(\"侧门。\", \"Side door.\")}\n-> END");
    t.setLanguage("en");
    expect(t.startAt("side").paragraphs.map((p) => p.text)).toEqual(["Side door."]);
  });

  test("a new session can start in a given language", async () => {
    const s = await session(BILINGUAL, { language: "en" });
    expect(s.start().paragraphs.map((p) => p.text)).toEqual(["Start."]);
  });

  test("saves keep enough to switch language after loading", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    const save = s.save()!;
    const t = await session();
    t.start();
    t.load(save);
    t.setLanguage("en");
    expect(texts(t)).toEqual(["Start.", "Dug."]);
    expect(gold(t)).toBe("1");
  });

  test("loading keeps the session's chosen language", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    const save = s.save()!;
    const t = await session(BILINGUAL, { language: "en" });
    t.start();
    t.load(save);
    expect(t.language).toBe("en");
    expect(texts(t)).toEqual(["Start.", "Dug."]);
  });

  test("an old save without replay data still loads; switching then only affects new text", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    const { state, log, startPoint } = s.save()!;
    const t = await session();
    t.start();
    t.load({ state, log, startPoint });
    t.setLanguage("en");
    expect(t.language).toBe("en");
    expect(texts(t)).toEqual(["开始。", "挖到了。"]);
    t.choose(0);
    expect(texts(t)).toEqual(["开始。", "挖到了。", "Dug."]);
  });
});
