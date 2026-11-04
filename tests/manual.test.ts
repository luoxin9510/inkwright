import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { readConfig, validateConfig } from "../src/game/config";
import { PlaySession } from "../src/play/session";
import { parseRun, replayActions, withTaken, newRun } from "../src/play/run";
import { mergeAsides } from "../src/play/journal";

const compile = (src: string) => new Compiler(src).Compile();

/** hp 0..10; a choice reads it, so a change shows from the next choice on. */
const SRC = 'VAR lang = "zh"\nVAR hp = 5\n开始,生命 {hp}。\n+ [{lang == "en": Go|走}] -> k\n=== k ===\n生命 {hp}。\n+ [{lang == "en": Again|再走}] -> k\n';
const clamp = (name: string, v: number) => (name === "hp" ? Math.min(10, Math.max(0, v)) : v);
const session = () => {
  const s = new PlaySession(compile(SRC), { clampVar: clamp });
  s.start();
  return s;
};
const adjust = (delta: number) => ({ kind: "adjust" as const, lang: "zh", var: "hp", delta, result: null });

describe("manual changes (the player is the game master)", () => {
  test("an adjust adds to the variable, within its range, and records what it came to", () => {
    const s = session();
    const a = s.applyManual(adjust(-2))!;
    expect(s.read("hp")).toBe(3);
    expect(a).toMatchObject({ kind: "adjust", var: "hp", delta: -2, result: { from: 5, to: 3 }, at: 1, after: 0 });
    s.applyManual(adjust(-10));
    expect(s.read("hp")).toBe(0);
    s.applyManual({ kind: "set", lang: "zh", var: "hp", value: 99, result: null });
    expect(s.read("hp")).toBe(10);
    // The next text reads the new value.
    expect(s.choose(0).paragraphs[0].text).toBe("生命 10。");
  });

  test("undo puts the variable back; backing out a choice takes the changes after it too", () => {
    const s = session();
    s.applyManual(adjust(-2));
    s.choose(0);
    s.applyManual(adjust(-1));
    expect(s.read("hp")).toBe(2);
    s.undo();
    expect(s.read("hp")).toBe(3);
    s.applyManual(adjust(+4));
    s.back();
    expect(s.read("hp")).toBe(3);
    expect(s.asides.map((a) => a.kind)).toEqual(["adjust"]);
    s.undo();
    expect(s.read("hp")).toBe(5);
  });

  test("a variable the story does not have is not changed: nothing is recorded", () => {
    const s = session();
    expect(s.applyManual({ kind: "adjust", lang: "zh", var: "mana", delta: 1, result: null })).toBeNull();
    expect(s.asides).toEqual([]);
  });

  test("switching language and replaying apply the changes again where they were made", async () => {
    const s = session();
    s.applyManual(adjust(-2));
    s.choose(0);
    s.applyManual(adjust(-1));
    s.setLanguage("en");
    expect(s.read("hp")).toBe(2);
    expect(s.asides.map((a) => [a.at, a.after])).toEqual([[1, 0], [2, 1]]);
    const t = new PlaySession(compile(SRC.replace("VAR hp = 5", "VAR hp = 7")), { clampVar: clamp });
    t.start();
    const r = await t.replay([{ index: -1, text: null, lang: "zh", seq: 0, aside: adjust(-2) }, { ...s.taken[0], text: "走" }, { index: -1, text: null, lang: "zh", seq: 2, aside: adjust(-1) }], { mode: "match" });
    expect(r.stop).toBeNull();
    // Deltas, not values: the new starting hp 7 goes to 4.
    expect(t.read("hp")).toBe(4);
    // A change to a variable that is gone is skipped, not a stop.
    const u = new PlaySession(compile(SRC), { clampVar: clamp });
    u.start();
    const ru = await u.replay([{ index: -1, text: null, lang: "zh", seq: 0, aside: { kind: "adjust", lang: "zh", var: "mana", delta: 1, result: null } }, { ...s.taken[0], text: "走" }]);
    expect(ru.stop).toBeNull();
    expect(ru.skipped).toEqual([0]);
  });
});

describe("manual changes in the run and the config", () => {
  test("adjust and set are kept as actions, replayed as asides, and checked when read", () => {
    const placed = [
      { kind: "adjust" as const, lang: "zh", var: "hp", delta: -2, result: { from: 5, to: 3 }, seq: 0, at: 1, after: 0 },
      { kind: "set" as const, lang: "zh", var: "hp", value: 9, result: { from: 3, to: 9 }, seq: 1, at: 1, after: 0 },
    ];
    const run = withTaken(newRun({ story: "a.ink", name: "", draft: true, startPoint: null, character: null, device: "A", now: "2026-11-04T10:00:00.000Z" }), [], 2, "2026-11-04T10:00:00.000Z", placed);
    expect(run.actions).toEqual([
      { kind: "adjust", seq: 0, lang: "zh", var: "hp", delta: -2 },
      { kind: "set", seq: 1, lang: "zh", var: "hp", value: 9 },
    ]);
    expect(replayActions(run).map((a) => a.aside)).toEqual([
      { kind: "adjust", lang: "zh", var: "hp", delta: -2, result: null },
      { kind: "set", lang: "zh", var: "hp", value: 9, result: null },
    ]);
    expect(parseRun(JSON.stringify(run))).toEqual(run);
    expect(parseRun(JSON.stringify({ ...run, actions: [{ kind: "adjust", seq: 0, lang: null, var: "hp", delta: "1" }] }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...run, actions: [{ kind: "set", seq: 0, lang: null, var: 3, value: 1 }] }))).toBeNull();
  });

  test("resources can be drawn as a clock or a track and be changed by hand; a track's span is whole boxes", () => {
    const fm = { rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }],
      resources: [{ id: "doom", min: 0, max: 6, initial: 0, display: "clock" }, { id: "vow", min: 0, max: 40, initial: 0, display: "track", manual: true }] };
    const { config, problems } = readConfig(fm);
    expect(problems).toEqual([]);
    expect(config?.resources.map((r) => [r.display, r.manual])).toEqual([["clock", undefined], ["track", true]]);
    expect(readConfig({ ...fm, resources: [{ id: "x", min: 0, max: 4, initial: 0, display: "pie" }] }).problems).toEqual([{ code: "shape", args: ["resources[0]"] }]);
    expect(validateConfig({ ...config!, resources: [{ id: "vow", min: 0, max: 30, initial: 0, display: "track" }] })).toContainEqual({ code: "resourceTrack", args: ["vow", "30"] });
  });
});

test("ticks in a row on the same variable, at the same place, show as one change", () => {
  const s = session();
  for (let i = 0; i < 3; i++) s.applyManual(adjust(1));
  s.applyManual({ kind: "set", lang: "zh", var: "hp", value: 2, result: null });
  s.applyManual(adjust(-1));
  s.choose(0);
  s.applyManual(adjust(1));
  expect(mergeAsides(s.asides).map((a) => [a.kind, a.delta ?? a.value, a.result])).toEqual([
    ["adjust", 3, { from: 5, to: 8 }],
    ["set", 2, { from: 8, to: 2 }],
    ["adjust", -1, { from: 2, to: 1 }],
    ["adjust", 1, { from: 1, to: 2 }],
  ]);
  expect(s.asides).toHaveLength(6);
});
