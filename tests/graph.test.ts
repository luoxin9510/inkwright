import { describe, expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";

const SRC = [
  "Top.",                   // 1
  "-> a",                   // 2
  "=== a ===",              // 3
  "* [go b] -> b",          // 4
  "* [tunnel] -> t ->",     // 5
  "  back",                 // 6
  "  -> END",               // 7
  "=== b ===",              // 8
  "<- th",                  // 9
  "~ f()",                  // 10
  "-> b.s2",                // 11
  "= s1",                   // 12
  "S1 -> DONE",             // 13
  "= s2",                   // 14
  "- (lab) x",              // 15
  "-> lab",                 // 16
  "=== t ===",              // 17
  "T ->->",                 // 18
  "=== th ===",             // 19
  "* [thread choice] -> END", // 20
  "=== function f ===",     // 21
  "~ return 1",             // 22
  "=== empty ===",          // 23
  "= first",                // 24
  "F -> END",               // 25
].join("\n");

async function graph() {
  const r = await compileStory("main.ink", async () => SRC);
  expect(r.ok).toBe(true);
  return r.graph!;
}

describe("story graph", () => {
  test("nodes: start, knots and stitches (no functions), end", async () => {
    const g = await graph();
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([
      ["@start", "start"],
      ["a", "knot"],
      ["b", "knot"],
      ["b.s1", "stitch"],
      ["b.s2", "stitch"],
      ["t", "knot"],
      ["th", "knot"],
      ["empty", "knot"],
      ["empty.first", "stitch"],
      ["@end", "end"],
    ]);
    expect(g.nodes.find((n) => n.id === "b.s2")).toMatchObject({ file: "main.ink", line: 14 });
  });

  test("edges by kind; function calls, implicit DONE and self-loops left out", async () => {
    const g = await graph();
    expect(g.edges.map((e) => `${e.from} -${e.kind}-> ${e.to}`).sort()).toEqual([
      "@start -divert-> a",
      "a -divert-> @end",
      "a -divert-> b",
      "a -tunnel-> t",
      "b -divert-> b.s2",
      "b -thread-> th",
      "b.s1 -divert-> @end",
      "empty -fall-> empty.first",
      "empty.first -divert-> @end",
      "th -divert-> @end",
    ]);
  });

  test("marks nodes that cannot be reached from the start", async () => {
    const g = await graph();
    expect(g.nodes.filter((n) => !n.reachable).map((n) => n.id)).toEqual(["b.s1", "empty", "empty.first"]);
  });

  test("repeated diverts between the same nodes are merged with a count", async () => {
    const r = await compileStory("main.ink", async () => "-> a\n=== a ===\n* [x] -> b\n* [y] -> b\n=== b ===\nB -> END");
    expect(r.graph!.edges.find((e) => e.from === "a" && e.to === "b")).toMatchObject({ count: 2 });
  });

  test("a failed compile has no graph", async () => {
    const r = await compileStory("main.ink", async () => "-> nowhere");
    expect(r.graph).toBeNull();
  });
});
