import { describe, expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { PlaySession } from "../src/play/session";

const SRC = [
  'VAR hp = 3',
  'VAR name = "小明"',
  'VAR ok = true',
  'VAR rate = 1.5',
  'LIST bag = torch, rope',
  '~ bag = torch',
  '-> a',
  '=== a ===',
  '= s',
  'hi',
  '* [x] -> b',
  '=== b ===',
  '~ hp = hp - 1',
  '~ bag += rope',
  'bye',
  '-> END',
].join("\n");

async function session() {
  const r = await compileStory("main.ink", async () => SRC);
  return new PlaySession(r.story!);
}

describe("PlaySession.inspect", () => {
  test("lists global variables in declaration order with readable values", async () => {
    const s = await session();
    s.start();
    expect(s.inspect().variables).toEqual([
      { name: "hp", value: "3" },
      { name: "name", value: '"小明"' },
      { name: "ok", value: "true" },
      { name: "rate", value: "1.5" },
      { name: "bag", value: "(torch)" },
    ]);
  });

  test("counts visits of every knot and stitch, even unreferenced ones", async () => {
    const s = await session();
    s.start();
    expect(s.inspect().visits).toEqual([
      { path: "a", count: 1 },
      { path: "a.s", count: 1 },
    ]);
  });

  test("updates after a choice", async () => {
    const s = await session();
    s.start();
    s.choose(0);
    const i = s.inspect();
    expect(i.variables.find((v) => v.name === "hp")!.value).toBe("2");
    expect(i.variables.find((v) => v.name === "bag")!.value).toBe("(torch, rope)");
    expect(i.visits).toContainEqual({ path: "b", count: 1 });
    expect(i.turns).toBe(1);
  });

  test("an empty list shows as ()", async () => {
    const r = await compileStory("main.ink", async () => "LIST l = a, b\nVAR x = ()\nhi\n-> END");
    const s = new PlaySession(r.story!);
    s.start();
    expect(s.inspect().variables).toContainEqual({ name: "x", value: "()" });
  });

  test("a story without variables gives empty lists", async () => {
    const r = await compileStory("main.ink", async () => "hi\n-> END");
    const s = new PlaySession(r.story!);
    s.start();
    expect(s.inspect()).toEqual({ variables: [], visits: [], turns: 0 });
  });

  test("labeled gathers are listed without compiler-generated path segments", async () => {
    const r = await compileStory("main.ink", async () => "-> k\n=== k ===\n= s\n- (talk) hi\n* [a] -> talk\n* [b] -> END\n- (top) x\n-> END");
    const s = new PlaySession(r.story!);
    s.start();
    s.choose(0);
    expect(s.inspect().visits).toEqual([
      { path: "k", count: 1 },
      { path: "k.s", count: 1 },
      { path: "k.s.talk", count: 2 },
    ]);
  });
});
