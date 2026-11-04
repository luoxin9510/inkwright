import { expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

const STORY = `-> main
${generateInk(CONFIG)}
=== main ===
{掷("3d6")} {检定("力量", 10)}
+ [再] -> main
+ [走] -> END
`;

function play(src: string, seed: number, choices = 3) {
  const engine = new GameEngine(CONFIG, { keepRolls: Infinity });
  const session = new PlaySession(new Compiler(src).Compile(), {
    setup: (s) => engine.setup(s, "昕"),
    prepare: (s) => engine.seed(s, seed),
    outcome: () => engine.signatures(),
  });
  session.start();
  for (let i = 0; i < choices; i++) session.choose(0);
  return { engine, session };
}

test("seed() makes the run's dice repeatable: the same seed rolls the same, another seed does not", () => {
  const a = play(STORY, 12345), b = play(STORY, 12345), c = play(STORY, 777);
  expect(b.session.log.map((p) => p.text)).toEqual(a.session.log.map((p) => p.text));
  expect(b.engine.signatures()).toEqual(a.engine.signatures());
  expect(c.engine.signatures()).not.toEqual(a.engine.signatures());
  expect(a.session.read("骰子种子")).toBe(12345);
  // Every roll of the run is kept and described: free dice and checks.
  expect(a.engine.signatures()).toHaveLength(8);
  expect(a.engine.signatures()[0]).toMatch(/^dice:3d6:\d+/);
  expect(a.engine.signatures()[1]).toMatch(/^check:力量:\d:/);
});

test("a story without the dice variables (a stale engine file) still rolls repeatably from the given seed", () => {
  const src = 'EXTERNAL 检定(技能, 难度)\n-> main\n=== main ===\n{检定("力量", 10)}\n+ [再] -> main\n=== function 检定(技能, 难度) ===\n~ return 0\n';
  const a = play(src, 42, 5), b = play(src, 42, 5), c = play(src, 43, 5);
  expect(b.engine.signatures()).toEqual(a.engine.signatures());
  expect(c.engine.signatures()).not.toEqual(a.engine.signatures());
});

test("the fingerprint of a choice changes when its roll comes out differently", () => {
  const a = play(STORY, 1, 1), b = play(STORY, 1, 1), c = play(STORY, 2, 1);
  expect(b.session.taken[0].fp).toBe(a.session.taken[0].fp);
  expect(c.session.taken[0].fp).not.toBe(a.session.taken[0].fp);
});
