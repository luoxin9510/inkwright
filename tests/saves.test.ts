import { describe, expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { PlaySession } from "../src/play/session";

const SRC = [
  "VAR gold = 0",
  "Start.",
  "- (hub)",
  "+ [Dig] Dug.",
  "  ~ gold += 1",
  "  -> hub",
  "+ [Leave] Bye.",
  "  -> END",
].join("\n");

async function session() {
  const r = await compileStory("main.ink", async () => SRC);
  return new PlaySession(r.story!);
}
const gold = (s: PlaySession) => s.inspect().variables.find((v) => v.name === "gold")!.value;
const texts = (s: PlaySession) => s.log.map((p) => p.text);

describe("PlaySession log", () => {
  test("accumulates every paragraph since the start", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    expect(texts(s)).toEqual(["Start.", "Dug."]);
  });

  test("restart clears it", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    s.restart();
    expect(texts(s)).toEqual(["Start."]);
  });
});

describe("save and load", () => {
  test("loading restores choices, variables and the text so far", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    const save = s.save()!;
    s.choose(0);
    s.choose(0);
    expect(gold(s)).toBe("3");
    const step = s.load(save);
    expect(step.errors).toEqual([]);
    expect(step.choices.map((c) => c.text)).toEqual(["Dig", "Leave"]);
    expect(gold(s)).toBe("1");
    expect(texts(s)).toEqual(["Start.", "Dug."]);
  });

  test("a save can be loaded into a freshly compiled copy of the same story", async () => {
    const a = await session();
    a.start();
    a.choose(0);
    const save = a.save()!;
    const b = await session();
    b.load(save);
    expect(gold(b)).toBe("1");
  });

  test("a broken save is reported instead of throwing", async () => {
    const s = await session();
    s.start();
    const step = s.load({ state: "{not json", log: [], startPoint: null });
    expect(step.errors.length).toBeGreaterThan(0);
  });

  test("nothing to save while a looping story is halted", async () => {
    const r = await compileStory("main.ink", async () => "-> a\n=== a ===\nhi\n-> a");
    const s = new PlaySession(r.story!, { timeBudgetMs: 100 });
    s.start();
    expect(s.save()).toBeNull();
  });
});

describe("back (undo the last choice)", () => {
  test("returns to the state before the last choice", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    s.choose(0);
    const step = s.back()!;
    expect(gold(s)).toBe("1");
    expect(texts(s)).toEqual(["Start.", "Dug."]);
    expect(step.choices.map((c) => c.text)).toEqual(["Dig", "Leave"]);
    expect(s.canGoBack).toBe(true);
  });

  test("can go back to the very beginning, then no further", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    s.back();
    expect(texts(s)).toEqual(["Start."]);
    expect(s.canGoBack).toBe(false);
    expect(s.back()).toBeNull();
  });

  test("works after reaching an ending", async () => {
    const s = await session();
    s.start();
    s.choose(1);
    expect(s.back()!.ended).toBe(false);
  });
});
