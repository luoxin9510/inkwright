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

test("game mode counts each table's rows, each deck's cards and each check, and gives the spread of the resources", async () => {
  const config = {
    ...CONFIG,
    tables: [{
      id: "encounter", name: { zh: "遭遇", en: "Encounter" }, dice: "1d6",
      rows: [
        { range: "1-3", text: { zh: "狼", en: "Wolf" }, id: "wolf" },
        { range: "4-6", text: { zh: "熊", en: "Bear" } },
        { range: "7+", text: { zh: "龙", en: "Dragon" } },
      ],
    }],
    decks: [{ id: "线索", name: { zh: "线索", en: "Clues" }, cards: [{ id: "血手印", name: { zh: "血手印", en: "Bloody handprint" } }, { id: "半张票", name: { zh: "半张票", en: "Half a ticket" } }, { id: "钥匙扣", name: { zh: "钥匙扣", en: "Key ring" } }] }],
  };
  const s = await story([
    "-> main",
    generateInk(config),
    "=== main ===",
    "~ temp e = 查表(\"encounter\")",
    "~ temp c = 抽牌(\"线索\")",
    "遇到{e}。",
    "* [撬 #check:力量:10]",
    '    { 检定("力量", 10) >= 3:',
    "        开了。",
    "    - else:",
    "        ~ 恐惧 += 100",
    "        断了。",
    "    }",
    "    -> END",
  ].join("\n"));
  const r = simulateStory(s, { game: config, character: "昕", runs: 200, seed: 4 });
  expect(r).toEqual(simulateStory(s, { game: config, character: "昕", runs: 200, seed: 4 }));
  expect(r.errors).toEqual([]);

  const [table] = r.tables ?? [];
  expect(table).toMatchObject({ table: "encounter", name: "遭遇", rolls: 200, perRun: 1, none: 0 });
  expect(table.rows.map((x) => [x.range, x.id, x.text])).toEqual([["1-3", "wolf", "狼"], ["4-6", undefined, "熊"], ["7+", undefined, "龙"]]);
  expect(table.rows.reduce((n, x) => n + x.count, 0)).toBe(200);
  expect(table.rows[0].count).toBeGreaterThan(60);
  expect(table.rows[1].count).toBeGreaterThan(60);
  expect(table.rows[2].count).toBe(0); // a d6 never reaches 7: the row is never read

  const [deck] = r.decks ?? [];
  expect(deck).toMatchObject({ deck: "线索", name: "线索", draws: 200, perRun: 1 });
  expect(deck.cards.map((c) => c.id)).toEqual(["血手印", "半张票", "钥匙扣"]);
  expect(deck.cards.reduce((n, c) => n + c.count, 0)).toBe(200);
  for (const c of deck.cards) expect(c.count).toBeGreaterThan(30);

  const [check] = r.checks ?? [];
  expect(check).toMatchObject({ skill: "力量", difficulty: 10, count: 200 });
  expect(check.success).toBeGreaterThan(0);
  expect(check.success).toBeLessThan(1);

  const fear = r.resources?.find((x) => x.resource === "恐惧");
  const failed = Math.round(200 * (1 - check.success));
  expect(fear).toMatchObject({ atMin: 200 - failed, atMax: failed });
  expect(fear?.percentiles).toEqual({ p10: 0, p50: failed > 100 ? 100 : 0, p90: 100 });
});

test("in English, names in the counts follow the story's language; drawing from an empty pile rolls nothing", async () => {
  const config = { ...CONFIG, decks: [{ id: "线索", name: { zh: "线索", en: "Clues" }, cards: [{ id: "血手印", name: { zh: "血手印", en: "Bloody handprint" } }] }] };
  const s = await story(["-> main", generateInk(config), "=== main ===", "~ temp a = 抽牌(\"线索\")", "~ temp b = 抽牌(\"线索\")", "完。", "-> END"].join("\n"));
  const r = simulateStory(s, { game: config, runs: 5, language: "en" });
  // The generated draw returns an empty list without rolling once the pile is empty: one draw per run.
  expect(r.decks).toEqual([{ deck: "线索", name: "Clues", draws: 5, perRun: 1, cards: [{ id: "血手印", name: "Bloody handprint", count: 5 }] }]);
  expect(r.tables).toEqual([]);
});
