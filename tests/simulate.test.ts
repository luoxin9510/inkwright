import { expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { generateInk } from "../src/game/inkgen";
import { simulateStory } from "../src/play/simulate";
import { CONFIG } from "./fixtures/gameConfig";

async function story(src: string) {
  const r = await compileStory("main.ink", async () => src);
  if (!r.story) throw new Error(JSON.stringify(r.diagnostics));
  return r.story;
}

test("random runs report the odds of each ending, and a seed makes them repeatable", async () => {
  const s = await story("* [a] A. -> END\n* [b] B. -> END");
  const r = simulateStory(s, { runs: 50, seed: 7 });
  expect(r).toEqual(simulateStory(s, { runs: 50, seed: 7 }));
  expect(r.endings.map((e) => e.lastText).sort()).toEqual(["A.", "B."]);
  expect(r.endings.reduce((n, e) => n + e.count, 0)).toBe(50);
  expect(r.steps).toEqual({ min: 1, mean: 1, max: 1 });
  expect(r.truncated).toBe(0);
  expect(r.errors).toEqual([]);
});

test("game mode rolls real dice: both sides of a check turn up, and the resources at the end are reported", async () => {
  const s = await story([
    "-> main",
    generateInk(CONFIG),
    "=== main ===",
    "* [撬 #check:力量:10]",
    '    { 检定("力量", 10) >= 3:',
    "        开了。",
    "        -> END",
    "    - else:",
    "        ~ 恐惧 += 10",
    "        断了。",
    "    }",
    "    -> main",
    "* [走]",
    "    走了。",
    "    -> END",
  ].join("\n"));
  const r = simulateStory(s, { game: CONFIG, character: "昕", runs: 60, seed: 3 });
  expect(r.endings.map((e) => e.lastText).sort()).toEqual(["开了。", "走了。"]);
  const fear = r.resources?.find((x) => x.resource === "恐惧");
  expect(fear?.end.min).toBe(0);
  expect(fear?.end.max).toBe(10);
  expect(r.resources?.some((x) => x.resource === "恐惧_阿波")).toBe(true);
  expect(r.errors).toEqual([]);
});

test("endless runs are counted as truncated, runtime errors come with the choices of the first run that hit them", async () => {
  const loop = await story("-> k\n=== k ===\n+ [again] -> k");
  expect(simulateStory(loop, { runs: 3, maxSteps: 5 }).truncated).toBe(3);
  const broken = await story("-> k\n=== k ===\n* [a]\n  Nothing after this.");
  const r = simulateStory(broken, { runs: 4 });
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0].count).toBe(4);
  expect(r.errors[0].choices).toEqual(["a"]);
});

test("a run that meets a spot where every choice is locked is counted as stuck", async () => {
  const s = await story(["-> main", generateInk(CONFIG), "=== main ===", "* [用刀 #needs:刀] -> END"].join("\n"));
  const r = simulateStory(s, { game: CONFIG, character: "昕", runs: 2 });
  expect(r.stuck).toBe(2);
  expect(r.endings).toEqual([]);
});
