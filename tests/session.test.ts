import { describe, expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { PlaySession } from "../src/play/session";

async function story(src: string) {
  const r = await compileStory("main.ink", async () => src);
  if (!r.story) throw new Error(JSON.stringify(r.diagnostics));
  return r.story;
}

describe("PlaySession", () => {
  test("start shows the opening text and choices", async () => {
    const s = new PlaySession(await story("Hello\n* [Go] Went\n  -> END"));
    const step = s.start();
    expect(step.paragraphs.map((p) => p.text)).toEqual(["Hello"]);
    expect(step.choices).toEqual([{ index: 0, text: "Go" }]);
    expect(step.ended).toBe(false);
  });

  test("choosing advances to the ending", async () => {
    const s = new PlaySession(await story("Hello\n* [Go] Went\n  -> END"));
    s.start();
    const step = s.choose(0);
    expect(step.paragraphs.map((p) => p.text)).toEqual(["Went"]);
    expect(step.choices).toEqual([]);
    expect(step.ended).toBe(true);
  });

  test("restart returns to the same opening step", async () => {
    const s = new PlaySession(await story("Hello\n* [Go] Went\n  -> END"));
    const first = s.start();
    s.choose(0);
    expect(s.restart()).toEqual(first);
  });

  test("tags are attached to their paragraph", async () => {
    const s = new PlaySession(await story("Line #mood:sad\n-> END"));
    expect(s.start().paragraphs[0].tags).toEqual(["mood:sad"]);
  });

  test("an invalid choice index is reported in step.errors instead of throwing", async () => {
    const s = new PlaySession(await story("Hello\n* [Go] Went\n  -> END"));
    s.start();
    const step = s.choose(99);
    expect(step.errors.length).toBeGreaterThan(0);
  });
});

describe("PlaySession infinite-loop guard", () => {
  test("a story that loops forever printing text stops with an error instead of hanging", async () => {
    const s = new PlaySession(await story("-> a\n=== a ===\nhi\n-> a"), { timeBudgetMs: 200 });
    const step = s.start();
    expect(step.ended).toBe(true);
    expect(step.errors.some((e) => e.includes("无限循环"))).toBe(true);
  }, 5000);

  test("a story that loops forever without output stops with an error instead of hanging", async () => {
    const s = new PlaySession(await story("-> a\n=== a ===\n-> b\n=== b ===\n-> a"), { timeBudgetMs: 200 });
    const step = s.start();
    expect(step.ended).toBe(true);
    expect(step.errors.some((e) => e.includes("无限循环"))).toBe(true);
  }, 5000);

  test("restart after a halted loop does not throw and halts again", async () => {
    const s = new PlaySession(await story("-> a\n=== a ===\nhi\n-> a"), { timeBudgetMs: 100 });
    s.start();
    const step = s.restart();
    expect(step.ended).toBe(true);
    expect(step.errors.some((e) => e.includes("无限循环"))).toBe(true);
  }, 5000);
});

describe("PlaySession errors", () => {
  test("errors belong to the step that produced them", async () => {
    const s = new PlaySession(await story("Hello\n* [Go] Went\n  -> END"));
    s.start();
    expect(s.choose(99).errors.length).toBeGreaterThan(0);
    expect(s.choose(0).errors).toEqual([]);
  });

  test("errors are passed through the Chinese translation", async () => {
    const s = new PlaySession(await story("Hello\n* [Go] Went\n  -> END"));
    s.start();
    expect(s.choose(99).errors[0]).toMatch(/暂无中文翻译|[一-鿿]/);
  });
});

describe("PlaySession external functions", () => {
  test("a missing EXTERNAL binding becomes a step error instead of throwing", async () => {
    const s = new PlaySession(await story("EXTERNAL f()\nBefore\n~ f()\nAfter\n-> END"));
    const step = s.start();
    expect(step.ended).toBe(true);
    expect(step.errors.some((e) => e.includes("外部函数 'f' 没有绑定"))).toBe(true);
  });

  test("an ink function with the same name is used as the fallback", async () => {
    const s = new PlaySession(await story("EXTERNAL f()\n{f()}\n-> END\n=== function f() ===\n~ return 7"));
    const step = s.start();
    expect(step.paragraphs.map((p) => p.text)).toEqual(["7"]);
    expect(step.errors).toEqual([]);
  });
});
