import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { liveBlocks, liveHeader } from "../src/play/journal";
import { PlaySession } from "../src/play/session";
import { inputPayload } from "../src/play/input";
import { readConfig } from "../src/game/config";

const SRC = 'VAR entry = ""\n开场。\n+ [推门] -> k\n=== k ===\n门开了。\n里面很黑。\n+ [写下来 #write:entry]\n    {entry}\n    -> k2\n=== k2 ===\n+ [再来] -> k\n';
const oracle = { kind: "oracle" as const, lang: "zh", question: "有人吗", odds: "even", result: { roll: 30, threshold: 50, answer: "yes", extreme: false } };

/** What the live journal reads from a session. */
const input = (s: PlaySession, written: { seq: number; top: number }) => ({
  language: "zh" as const, log: s.log, turns: s.turns, rolls: [],
  taken: s.taken.map((t, i) => ({ seq: t.seq, text: t.text, at: s.choicesMade[i].at, payload: t.payload, write: i === 1 })),
  asides: s.asides, writtenSeq: written.seq, writtenTop: written.top,
});

describe("the live journal", () => {
  test("the header carries the text before the first choice", () => {
    const s = new PlaySession(new Compiler(SRC).Compile());
    s.start();
    expect(liveHeader({ title: "灯塔", date: new Date(2026, 10, 4, 21, 5), language: "zh", character: null }, input(s, { seq: -1, top: -1 }))).toBe("# 灯塔\n\n2026-11-04 21:05\n\n开场。\n");
  });

  test("each action is appended once: a choice with the text it brought, an aside as a line; only what is new", () => {
    const s = new PlaySession(new Compiler(SRC).Compile());
    s.start();
    s.choose(0);
    s.addAside(oracle);
    const first = liveBlocks(input(s, { seq: -1, top: -1 }));
    expect(first.text).toBe("\n**→ 推门**\n\n门开了。\n\n里面很黑。\n\n> 🔮 有人吗 (一半一半)d100 30 / 50 → 是\n");
    expect(first).toMatchObject({ writtenSeq: 1, writtenTop: 1 });
    // Nothing new: nothing written.
    expect(liveBlocks(input(s, { seq: 1, top: 1 })).text).toBe("");
    // A paragraph written (#write) shows as a quote under its choice.
    s.choose(0, inputPayload("entry", "风很大\n灯还亮着")!);
    const second = liveBlocks(input(s, { seq: first.writtenSeq, top: first.writtenTop }));
    expect(second.text).toBe("\n**→ 写下来**\n\n> 风很大\n> 灯还亮着\n\n风很大\n灯还亮着\n");
    expect(second).toMatchObject({ writtenSeq: 2, writtenTop: 2 });
  });

  test("after back, a line says so and the new way is appended; nothing written is taken out", () => {
    const s = new PlaySession(new Compiler(SRC).Compile());
    s.start();
    s.choose(0);
    s.addAside(oracle);
    const w = liveBlocks(input(s, { seq: -1, top: -1 }));
    s.undo();
    s.undo();
    s.choose(0);
    const again = liveBlocks(input(s, { seq: w.writtenSeq, top: w.writtenTop }));
    expect(again.text).toBe("\n↩ 回退到第 1 步\n\n**→ 推门**\n\n门开了。\n\n里面很黑。\n");
    expect(again).toMatchObject({ writtenSeq: 2, writtenTop: 2 });
    // Back with nothing new after it: the line alone.
    s.undo();
    expect(liveBlocks(input(s, { seq: again.writtenSeq, top: again.writtenTop })).text).toBe("\n↩ 回退到第 1 步\n");
  });

  test("the player's own text cannot break the note: quoted line by line", () => {
    const s = new PlaySession(new Compiler(SRC).Compile());
    s.start();
    s.choose(0);
    s.choose(0, inputPayload("entry", "# 标题\n---")!);
    expect(liveBlocks(input(s, { seq: 0, top: 0 })).text).toContain("> # 标题\n> ---\n");
  });
});

test("a game note can turn the live journal on or off for its story (false is kept, so it can override the setting)", () => {
  const fm = { rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }] };
  expect(readConfig({ ...fm, journal: { live: false } }).config?.journal).toEqual({ live: false });
  expect(readConfig({ ...fm, journal: { live: true, path: "日志/{date}.md" } }).config?.journal).toEqual({ path: "日志/{date}.md", live: true });
  expect(readConfig({ ...fm, journal: { live: "yes" } }).problems).toEqual([{ code: "shape", args: ["journal"] }]);
});
