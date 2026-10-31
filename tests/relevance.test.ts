import { expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { storyShape } from "../src/play/relevance";

async function shape(src: string) {
  const r = await compileStory("main.ink", async () => src);
  if (!r.story) throw new Error(JSON.stringify(r.diagnostics));
  const globals = (r.story.variablesState as unknown as { _globalVariables: Map<string, unknown> })._globalVariables.keys();
  return storyShape(JSON.parse(r.story.ToJson() as string), globals);
}

test("a variable matters when it is read for control, not when it is only printed or updated from itself", async () => {
  const s = await shape([
    "VAR printed = 1",
    "VAR counter = 0",
    "VAR gate = 0",
    "VAR source = 2",
    "VAR derived = 0",
    "VAR flag = false",
    "VAR written = false",
    "-> k",
    "=== k ===",
    "Printed {printed}.",
    "~ counter += 1",
    "~ derived = source + 1",
    "~ written = true",
    "{ gate > 0: Open. }",
    "{ derived == 3: Three. }",
    "+ {not flag} [again] -> k",
    "+ [out] -> END",
  ].join("\n"));
  // source feeds derived, which is compared; counter only updates itself; printed is only shown.
  expect([...s.relevant].sort()).toEqual(["derived", "flag", "gate", "source"]);
  expect([...s.thresholds]).toEqual([["gate", [0]], ["derived", [3]]]);
});

test("a condition inside text only picks words; a choice condition counts even when the text comes from a function", async () => {
  const s = await shape([
    "VAR a = 1",
    "VAR b = 1",
    "VAR c = 0",
    "-> k",
    "=== function t(x, y) ===",
    "~ return x",
    "=== function clamp(x, lo, hi) ===",
    "{ x < lo:",
    "    ~ return lo",
    "}",
    "~ return x",
    "=== k ===",
    '{t("{a > 0: yes|no}", "x")}',
    "~ c = clamp(c - 1, 0, 9)",
    '+ {b > 0} [{t("go", "go")}] -> END',
    "+ [stay] -> END",
  ].join("\n"));
  expect([...s.relevant]).toEqual(["b"]);
  expect([...s.functions].sort()).toEqual(["clamp", "t"]);
});

test("places are the author's knots, stitches and labels, functions left out; choice points belong to a place; sequences are counted", async () => {
  const s = await shape([
    "-> k",
    "=== function f() ===",
    "~ return 1",
    "=== function unused() ===",
    "~ return 2",
    "=== k ===",
    "= s",
    "- (here) Hi {f()}. {stopping: once|again}",
    "* [a] -> orphan",
    "* [b] -> END",
    "=== orphan ===",
    "Gone. -> END",
  ].join("\n"));
  expect(s.places.map((p) => p.name)).toEqual(["k", "k.s", "k.s.here", "orphan"]);
  expect(s.choices).toHaveLength(2);
  expect(s.choices.every((c) => c.place.startsWith("k.s"))).toBe(true);
  expect([...s.functions].sort()).toEqual(["f", "unused"]);
  expect(s.counted.size).toBe(1);
});
