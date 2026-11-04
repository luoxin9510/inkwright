import { describe, expect, test } from "vitest";
import { Compiler, Story } from "inkjs/full";
import { PlaySession, type ReplayAction } from "../src/play/session";

const compile = (src: string) => new Compiler(src).Compile();

/** A story whose text depends on ink's own RANDOM and shuffles, so a replay must restore storySeed. */
const RANDOM = `VAR lang = "zh"
-> k
=== k ===
{RANDOM(1, 1000)} {~甲|乙|丙|丁}
+ [{lang == "en": Again|再来}] -> k
+ [{lang == "en": Stop|停}] -> END
`;

/** Seeds written the way the panel will: after setup, before the language and the start point. */
const seeded = (seed: number) => ({ prepare: (s: Story) => { s.state.storySeed = seed; s.state.previousRandom = 0; } });

const texts = (s: PlaySession) => s.log.map((p) => p.text);
const actions = (s: PlaySession): ReplayAction[] => s.taken.map((t) => ({ index: t.index, text: t.text, payload: t.payload, seq: t.seq, lang: t.lang }));

describe("seeds and the record of choices", () => {
  test("prepare runs on every fresh start: the same seed gives the same RANDOM and shuffles", () => {
    const a = new PlaySession(compile(RANDOM), seeded(7));
    a.start();
    for (let i = 0; i < 4; i++) a.choose(0);
    const b = new PlaySession(compile(RANDOM), seeded(7));
    b.start();
    for (let i = 0; i < 4; i++) b.choose(0);
    expect(texts(b)).toEqual(texts(a));
    const c = new PlaySession(compile(RANDOM), seeded(7));
    c.startAt(null);
    for (let i = 0; i < 4; i++) c.choose(0);
    expect(texts(c)).toEqual(texts(a));
  });

  test("each choice is recorded with its text, language, a seq that never repeats and a fingerprint", () => {
    const s = new PlaySession(compile(RANDOM), seeded(1));
    s.start();
    s.choose(0);
    s.choose(0);
    expect(s.taken.map((t) => [t.index, t.text, t.lang, t.seq])).toEqual([[0, "再来", "zh", 0], [0, "再来", "zh", 1]]);
    expect(s.taken[0].fp).toMatch(/^[0-9a-f]+$/);
    s.back();
    s.choose(1);
    // A seq freed by back is not used again.
    expect(s.taken.map((t) => [t.text, t.seq])).toEqual([["再来", 0], ["停", 2]]);
    expect(s.seqNext).toBe(3);
    s.restart();
    expect(s.taken).toEqual([]);
    expect(s.seqNext).toBe(3);
  });

  test("switching language rewrites the record in the new language and keeps the seqs", () => {
    const s = new PlaySession(compile(RANDOM), seeded(1));
    s.start();
    s.choose(0);
    s.choose(0);
    s.setLanguage("en");
    expect(s.taken.map((t) => [t.text, t.lang, t.seq])).toEqual([["Again", "en", 0], ["Again", "en", 1]]);
  });

  test("the fingerprint follows what was rolled during the choice, and how many choices come next", () => {
    // An EXTERNAL that "rolls": each call adds the next signature from a script.
    const src = "EXTERNAL hit()\n+ [a] -> k\n+ [b] -> k\n=== k ===\n{hit()}\n+ [x] -> END\n+ [y] -> END\n=== function hit() ===\n~ return 0\n";
    const play = (sig: string, index: number) => {
      const rolls: string[] = [];
      const s = new PlaySession(compile(src), {
        outcome: () => rolls,
        setup: (story) => story.BindExternalFunction("hit", () => { rolls.push(sig); return 0; }, false),
      });
      s.start();
      s.choose(index);
      return s.taken[0].fp;
    };
    expect(play("check:wits:3", 0)).not.toBe(play("check:wits:1", 0));
    expect(play("check:wits:3", 1)).toBe(play("check:wits:3", 0));
    const fewer = new PlaySession(compile("+ [a] -> END\n+ [b] -> k\n=== k ===\n+ [x] -> END\n+ [y] -> END\n"));
    fewer.start();
    fewer.choose(0);
    fewer.restart();
    const ended = fewer.taken.length;
    expect(ended).toBe(0);
  });
});

describe("replay", () => {
  test("replays a run on a fresh session: same text, back works, the seqs are kept", async () => {
    const a = new PlaySession(compile(RANDOM), seeded(3));
    a.start();
    for (let i = 0; i < 5; i++) a.choose(0);
    a.choose(1);
    const b = new PlaySession(compile(RANDOM), seeded(3));
    b.start();
    const r = await b.replay(actions(a));
    expect(r).toMatchObject({ done: 6, stop: null, aborted: false });
    expect(texts(b)).toEqual(texts(a));
    expect(b.taken).toEqual(a.taken);
    expect(b.seqNext).toBe(6);
    expect(b.canGoBack).toBe(true);
    b.back();
    expect(r.step.ended).toBe(true);
  });

  test("strict: a choice whose text changed stops the replay there; the rest is pending", async () => {
    const a = new PlaySession(compile(RANDOM), seeded(3));
    a.start();
    for (let i = 0; i < 3; i++) a.choose(0);
    a.choose(1);
    const changed = RANDOM.replace("Again|再来", "Again|再来一次");
    const b = new PlaySession(compile(changed), seeded(3));
    b.start();
    const r = await b.replay(actions(a));
    expect(r.done).toBe(0);
    expect(r.stop).toEqual({ at: 0, reason: "mismatch" });
    expect(b.taken).toEqual([]);
    // A change after the run's last choice does not matter.
    const later = "-> k\n=== k ===\n+ [a] -> m\n=== m ===\n+ [b] -> n\n=== n ===\n新的结尾。\n-> END\n";
    const c = new PlaySession(compile("-> k\n=== k ===\n+ [a] -> m\n=== m ===\n+ [b] -> n\n=== n ===\n结尾。\n-> END\n"));
    c.start();
    c.choose(0);
    const d = new PlaySession(compile(later));
    d.start();
    expect((await d.replay(actions(c))).stop).toBeNull();
  });

  test("a missing choice, or one past the end, stops the replay", async () => {
    const s = new PlaySession(compile("+ [a] -> END\n"));
    s.start();
    const r = await s.replay([{ index: 0, text: "a", seq: 0, lang: null }, { index: 0, text: "a", seq: 1, lang: null }]);
    expect(r).toMatchObject({ done: 1, stop: { at: 1, reason: "mismatch" } });
    const t = new PlaySession(compile("+ [a] -> END\n"));
    t.start();
    expect((await t.replay([{ index: 3, text: "a", seq: 0, lang: null }])).stop).toEqual({ at: 0, reason: "mismatch" });
  });

  test("an action recorded without its text (an old save) is checked by index only", async () => {
    const s = new PlaySession(compile("+ [a] -> k\n+ [b] -> k\n=== k ===\n到了。\n-> END\n"));
    s.start();
    const r = await s.replay([{ index: 1, text: null, seq: 0, lang: null }]);
    expect(r.stop).toBeNull();
    expect(s.taken[0].text).toBe("b");
  });

  test("an action in another language is checked by index only", async () => {
    const a = new PlaySession(compile(RANDOM), { ...seeded(3), language: "en" });
    a.start();
    a.choose(0);
    const b = new PlaySession(compile(RANDOM), seeded(3));
    b.start();
    expect((await b.replay(actions(a))).stop).toBeNull();
  });

  test("an old save with replay data starts from its start state, then replays its choices by index", async () => {
    const a = new PlaySession(compile(RANDOM), seeded(9));
    a.start();
    a.choose(0);
    a.choose(0);
    const save = a.save()!;
    const b = new PlaySession(compile(RANDOM), seeded(1));
    b.startFrom(save.start!);
    const r = await b.replay(save.picks!.map((p, i) => ({ index: p as number, text: null, lang: null, seq: i })));
    expect(r.stop).toBeNull();
    expect(texts(b)).toEqual(texts(a));
    const c = new PlaySession(compile(RANDOM));
    expect(c.startFrom("{ not json").errors).toHaveLength(1);
  });

  test("payloads are replayed", async () => {
    const src = 'VAR cat = "猫"\n+ [起名 #input:cat] 叫{cat}。\n-> END\n';
    const a = new PlaySession(compile(src));
    a.start();
    a.choose(0, { var: "cat", text: "煤球" });
    const b = new PlaySession(compile(src));
    b.start();
    await b.replay(actions(a));
    expect(texts(b).at(-1)).toBe("叫煤球。");
  });

  test("a step that loops forever stops the replay with an error", async () => {
    const src = "+ [a] -> loop\n=== loop ===\n-> loop\n";
    const s = new PlaySession(compile(src), { timeBudgetMs: 50 });
    s.start();
    const r = await s.replay([{ index: 0, text: "a", seq: 0, lang: null }, { index: 0, text: "x", seq: 1, lang: null }]);
    expect(r.stop).toEqual({ at: 1, reason: "error" });
  });

  test("it yields while it works, can be aborted, and stops when its budget is used up", async () => {
    const long = Array.from({ length: 300 }, () => ({ index: 0, text: "再来", seq: 0, lang: "zh" })).map((a, i) => ({ ...a, seq: i }));
    const progress: number[] = [];
    const s = new PlaySession(compile(RANDOM), seeded(1));
    s.start();
    const controller = new AbortController();
    const running = s.replay(long, { signal: controller.signal, sliceMs: 0, onProgress: (n) => { progress.push(n); if (n === 10) controller.abort(); } });
    const r = await running;
    expect(r.aborted).toBe(true);
    expect(r.done).toBeLessThan(300);
    const t = new PlaySession(compile(RANDOM), seeded(1));
    t.start();
    const b = await t.replay(long, { budgetMs: 0 });
    expect(b.stop).toEqual({ at: 0, reason: "budget" });
    const u = new PlaySession(compile(RANDOM), seeded(1));
    u.start();
    expect((await u.replay(long)).done).toBe(300);
  });
});
