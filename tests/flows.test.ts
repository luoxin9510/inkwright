import { describe, expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import type { ReadFile } from "../src/compile/include";
import { PlaySession } from "../src/play/session";

function memory(files: Record<string, string>): ReadFile {
  return async (p) => {
    if (!(p in files)) throw new Error("ENOENT " + p);
    return files[p];
  };
}

const SRC = [
  "VAR x = 1",          // 1
  "Opening.",           // 2
  "-> a",               // 3
  "=== a ===",          // 4
  "A",                  // 5
  "= s",                // 6
  "S",                  // 7
  "-> END",             // 8
  "=== function f ===", // 9
  "~ return 1",         // 10
  "=== b ===",          // 11
  "B {x}",              // 12
  "-> END",             // 13
].join("\n");

describe("CompileResult.flows", () => {
  test("lists knots and stitches with file and line, excluding functions", async () => {
    const r = await compileStory("main.ink", memory({ "main.ink": SRC }));
    expect(r.flows).toEqual([
      { path: "a", kind: "knot", file: "main.ink", line: 4 },
      { path: "a.s", kind: "stitch", file: "main.ink", line: 6 },
      { path: "b", kind: "knot", file: "main.ink", line: 11 },
    ]);
  });

  test("flows from an INCLUDEd file point at that file", async () => {
    const r = await compileStory("s/main.ink", memory({
      "s/main.ink": "INCLUDE ch/one.ink\n-> one",
      "s/ch/one.ink": "=== one ===\nOne\n-> END",
    }));
    expect(r.flows).toEqual([{ path: "one", kind: "knot", file: "s/ch/one.ink", line: 1 }]);
  });

  test("a failed compile has no flows", async () => {
    const r = await compileStory("main.ink", memory({ "main.ink": "-> nowhere" }));
    expect(r.flows).toEqual([]);
  });
});

describe("PlaySession start point", () => {
  async function session() {
    const r = await compileStory("main.ink", memory({ "main.ink": SRC }));
    return new PlaySession(r.story!);
  }

  test("startAt jumps straight to a knot", async () => {
    const s = await session();
    expect(s.startAt("b").paragraphs.map((p) => p.text)).toEqual(["B 1"]);
  });

  test("startAt works for a stitch", async () => {
    const s = await session();
    expect(s.startAt("a.s").paragraphs.map((p) => p.text)).toEqual(["S"]);
  });

  test("restart returns to the chosen start point", async () => {
    const s = await session();
    s.startAt("b");
    expect(s.restart().paragraphs.map((p) => p.text)).toEqual(["B 1"]);
    expect(s.startPoint).toBe("b");
  });

  test("startAt(null) goes back to the beginning", async () => {
    const s = await session();
    s.startAt("b");
    // A knot with its own content does not fall into its first stitch.
    expect(s.startAt(null).paragraphs.map((p) => p.text)).toEqual(["Opening.", "A"]);
    expect(s.startPoint).toBeNull();
  });

  test("an unknown path is reported instead of throwing", async () => {
    const s = await session();
    const step = s.startAt("nope");
    expect(step.ended).toBe(true);
    expect(step.errors.length).toBeGreaterThan(0);
  });

  test("starting midway does not count as a choice made", async () => {
    const s = await session();
    s.startAt("b");
    expect(s.inspect().turns).toBe(0);
  });
});
