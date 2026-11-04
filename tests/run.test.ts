import { describe, expect, test } from "vitest";
import { mergeRuns, migrateSave, newRun, replayActions, storyFolder, withTaken, type Run } from "../src/play/run";
import type { Taken } from "../src/play/session";

const NOW = "2026-11-04T10:00:00.000Z";
const taken = (n: number, from = 0): Taken[] =>
  Array.from({ length: n }, (_, i) => ({ index: 0, text: `c${from + i}`, lang: "zh", seq: from + i, fp: "f", offered: [] }));
const base = () => newRun({ story: "游戏/雨夜来客/main.ink", name: "", draft: true, startPoint: null, character: "xin", device: "A", now: NOW, random: () => 0.5 });

describe("runs", () => {
  test("a new run has its seeds, no actions and revision 0", () => {
    const r = base();
    expect(r).toMatchObject({ schema: 1, id: "draft", story: "游戏/雨夜来客/main.ink", draft: true, character: "xin", actions: [], seqNext: 0, rev: 0, baseRev: 0, device: "A" });
    expect(Object.keys(r.seeds)).toEqual(["story", "dice", "oracle"]);
    expect(newRun({ ...{ story: "a.ink", name: "第一局", draft: false, startPoint: null, character: null, device: "A", now: NOW } }).id).not.toBe("draft");
  });

  test("the session's record becomes the run's choose actions; pending goes", () => {
    const r = withTaken({ ...base(), pending: [] }, taken(3), 3, "2026-11-04T11:00:00.000Z");
    expect(r.actions.map((a) => [a.kind, a.seq])).toEqual([["choose", 0], ["choose", 1], ["choose", 2]]);
    expect(r.actions[0]).toEqual({ kind: "choose", seq: 0, lang: "zh", index: 0, text: "c0", fp: "f", offered: [] });
    expect(r.pending).toBeUndefined();
    expect(r.seqNext).toBe(3);
    expect(r.updatedAt).toBe("2026-11-04T11:00:00.000Z");
    expect(replayActions(r)).toEqual([0, 1, 2].map((i) => ({ index: 0, text: `c${i}`, lang: "zh", seq: i, fp: "f", offered: [] })));
  });

  test("the story's folder is named after it, with a hash of its path", () => {
    expect(storyFolder("游戏/雨夜来客/main.ink")).toMatch(/^雨夜来客-[0-9a-f]{8}$/);
    expect(storyFolder("故事/开端.ink")).toMatch(/^开端-[0-9a-f]{8}$/);
    expect(storyFolder("main.ink")).toMatch(/^main-[0-9a-f]{8}$/);
    expect(storyFolder("a/b:c?.ink")).toMatch(/^b_c_-[0-9a-f]{8}$/);
    expect(storyFolder("游戏/雨夜来客/main.ink")).not.toBe(storyFolder("游戏/别的/main.ink"));
  });
});

describe("merging what each device wrote", () => {
  const file = (device: string, rev: number, baseRev: number, n: number): Run => ({ ...withTaken(base(), taken(n), n, NOW), device, rev, baseRev });

  test("one file is the run", () => {
    expect(mergeRuns([file("A", 1, 0, 2)])).toEqual({ run: file("A", 1, 0, 2), conflicts: [], superseded: [] });
  });

  test("the newest revision wins; files it was based on are superseded, even when they are longer (a back)", () => {
    const old = file("B", 3, 2, 6);
    const backed = file("A", 4, 3, 5);
    const m = mergeRuns([old, backed]);
    expect(m.run).toBe(backed);
    expect(m.conflicts).toEqual([]);
    expect(m.superseded).toEqual([old]);
  });

  test("written at the same time: a prefix of the winner is no conflict, a fork is", () => {
    const a = file("A", 4, 2, 5);
    const b = file("B", 3, 2, 4);
    expect(mergeRuns([a, b]).conflicts).toEqual([]);
    const fork: Run = { ...file("B", 3, 2, 4), actions: [...file("B", 3, 2, 3).actions, { kind: "choose", seq: 3, lang: "zh", index: 1, text: "别的", fp: "f" }] };
    const m = mergeRuns([a, fork]);
    expect(m.run).toBe(a);
    expect(m.conflicts).toEqual([fork]);
  });

  test("equal revisions: the later write wins, then the device id decides", () => {
    const a = { ...file("A", 2, 1, 3), updatedAt: "2026-11-04T10:00:00.000Z" };
    const b = { ...file("B", 2, 1, 3), updatedAt: "2026-11-04T10:05:00.000Z" };
    expect(mergeRuns([a, b]).run).toBe(b);
    const c = { ...file("C", 2, 1, 3) };
    expect(mergeRuns([c, a]).run).toBe(c);
  });
});

describe("old saves", () => {
  test("a save with replay data becomes a run that starts from its start state and checks choices by index", () => {
    const r = migrateSave({ id: "s1", name: "存档 1", savedAt: NOW, state: "{}", log: [{ text: "x", tags: [] }], startPoint: "雨夜", start: "{start}", picks: [1, { index: 0, payload: { var: "cat", text: "煤球" } }] }, "a.ink", "A");
    expect(r).toMatchObject({ id: "legacy-s1", name: "存档 1", draft: false, startPoint: "雨夜", legacy: { from: "start", state: "{start}" }, seqNext: 2 });
    expect(r.actions).toEqual([
      { kind: "choose", seq: 0, lang: null, index: 1, text: null, fp: "" },
      { kind: "choose", seq: 1, lang: null, index: 0, text: null, payload: { var: "cat", text: "煤球" }, fp: "" },
    ]);
  });

  test("a save without replay data keeps its state and text, with no actions", () => {
    const r = migrateSave({ id: "s2", name: "老档", savedAt: NOW, state: "{state}", log: [{ text: "x", tags: [] }], startPoint: null }, "a.ink", "A");
    expect(r).toMatchObject({ id: "legacy-s2", legacy: { from: "save", state: "{state}", log: [{ text: "x", tags: [] }] }, actions: [] });
  });
});
