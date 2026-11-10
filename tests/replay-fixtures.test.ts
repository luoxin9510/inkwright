import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Compiler } from "inkjs/full";
import { PlaySession, type ReplayAction } from "../src/play/session";

/**
 * Replay fixtures (solo PRD §5 "测试夹具"): each folder under tests/fixtures/replay/ is one rule of how a run
 * recorded on a story is found again after the story was edited. `before.ink` is played with `case.json`'s
 * choices (by text), the run is replayed on `after.ink` in the panel's "match" mode, and the result is compared
 * with `case.json`'s `expect`:
 *   done      actions replayed
 *   stop      "mismatch" | "error" | null
 *   guesses   positions of the actions found only by a guess
 *   last      text the last paragraph contains (where the replay left the player)
 *   choices   the choices on screen afterwards (optional)
 */
interface Case {
  rule: string;
  choices: string[];
  language?: string;
  expect: { done: number; stop: "mismatch" | "error" | null; guesses: number[]; last: string; choices?: string[] };
}

const ROOT = fileURLToPath(new URL("./fixtures/replay", import.meta.url));
const compile = (src: string) => new Compiler(src).Compile();

/** Plays `before` choosing by text; the run as the panel records it. */
function record(src: string, choices: string[], language?: string): ReplayAction[] {
  const s = new PlaySession(compile(src), { language });
  let step = s.start();
  for (const text of choices) {
    const c = step.choices.find((x) => x.text === text);
    if (!c) throw new Error(`no choice "${text}" in [${step.choices.map((x) => x.text).join(", ")}]`);
    step = s.choose(c.index);
  }
  return s.taken.map((t) => ({ index: t.index, text: t.text, lang: t.lang, payload: t.payload, seq: t.seq, fp: t.fp, offered: t.offered }));
}

describe("replay fixtures", () => {
  for (const name of readdirSync(ROOT).sort()) {
    const dir = join(ROOT, name);
    const c = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as Case;
    test(`${name}: ${c.rule}`, async () => {
      const actions = record(readFileSync(join(dir, "before.ink"), "utf8"), c.choices, c.language);
      const s = new PlaySession(compile(readFileSync(join(dir, "after.ink"), "utf8")), { language: c.language });
      s.start();
      const r = await s.replay(actions, { mode: "match" });
      expect({ done: r.done, stop: r.stop?.reason ?? null, guesses: r.guesses }).toEqual({ done: c.expect.done, stop: c.expect.stop, guesses: c.expect.guesses });
      expect(s.log.at(-1)?.text ?? "").toContain(c.expect.last);
      if (c.expect.choices) expect(r.step.choices.map((x) => x.text)).toEqual(c.expect.choices);
    });
  }
});
