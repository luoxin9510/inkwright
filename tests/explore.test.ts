import { expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { exploreStory } from "../src/play/explore";
import { generateInk } from "../src/game/inkgen";
import { CONFIG } from "./fixtures/gameConfig";

async function story(src: string) {
  const r = await compileStory("main.ink", async () => src);
  if (!r.story) throw new Error(JSON.stringify(r.diagnostics));
  return r.story;
}

test("visits every branch and lists each ending with the choices that lead there", async () => {
  const s = await story([
    "Start.",
    "* [A] A.",
    "  ** [A1] End A1. -> END",
    "  ** [A2] End A2. -> END",
    "* [B] End B. -> END",
  ].join("\n"));
  const r = exploreStory(s);
  // Breadth-first: shorter paths come first.
  expect(r.endings.map((e) => [e.choices, e.lastText])).toEqual([
    [["B"], "End B."],
    [["A", "A1"], "End A1."],
    [["A", "A2"], "End A2."],
  ]);
  expect(r.errors).toEqual([]);
  expect(r.truncated).toBe(false);
});

test("reports runtime errors with the choices that lead to them", async () => {
  const s = await story("* [Ok] Fine. -> END\n* [Bad] {RANDOM(3, 1)}\n  -> END");
  const r = exploreStory(s);
  expect(r.errors.length).toBe(1);
  expect(r.errors[0].choices).toEqual(["Bad"]);
});

test("stops at the state limit on endless loops and says so", async () => {
  const s = await story("- (hub)\n+ [Again] Again.\n  -> hub\n+ [Stop] -> END");
  const r = exploreStory(s, { maxSteps: 50, statesPerSpot: 100 });
  expect(r.truncated).toBe(true);
  expect(r.endings.length).toBeGreaterThan(0);
});

test("a spot is played on from at most statesPerSpot different states: a counting loop ends by itself", async () => {
  const s = await story("VAR n = 0\n- (hub)\nRound {n}.\n+ [Again]\n  ~ n++\n  -> hub\n+ [Stop] -> END");
  const r = exploreStory(s);
  expect(r.endings).toHaveLength(10);
  expect(r.endings.at(-1)?.choices).toEqual([...Array<string>(9).fill("Again"), "Stop"]);
  expect(r.cappedSpots).toBe(1);
  expect(r.truncated).toBe(false);
  expect(exploreStory(s, { statesPerSpot: 3 }).endings).toHaveLength(3);
});

test("plays a bilingual story in the given language", async () => {
  const s = await story('VAR lang = "en"\n* [{lang == "zh": 走|Go}] -> END');
  expect(exploreStory(s, { language: "zh" }).endings[0].choices).toEqual(["走"]);
});

const GAME = (choice: string) => [
  "-> main",
  generateInk(CONFIG),
  "=== main ===",
  "门。",
  `${choice} [撬 #check:力量:10]`,
  '    { 检定("力量", 10) >= 3:',
  "        开了。",
  "        -> END",
  "    - else:",
  "        断了。",
  choice === "*" ? "        ~ 恐惧 += 10" : "",
  "    }",
  "    -> main",
  `${choice} [走]`,
  "    走了。",
  "    -> END",
].join("\n");

test("game mode walks the success and the failure of every check, marking the outcome in the path", async () => {
  const r = exploreStory(await story(GAME("*")), { game: CONFIG, character: "昕" });
  expect(r.endings.map((e) => [e.choices, e.lastText])).toEqual([
    [["撬 [力量✓]"], "开了。"],
    [["走"], "走了。"],
    [["撬 [力量✗]", "走"], "走了。"],
  ]);
  expect(r.checks).toEqual({ walked: 2, noConsequence: [] });
  expect(r.truncated).toBe(false);
});

test("a failed check after which nothing changed is reported", async () => {
  // Sticky choice, no variable touched on failure: the player is back where they were.
  const r = exploreStory(await story(GAME("+")), { game: CONFIG, character: "昕" });
  expect(r.checks?.noConsequence[0]).toEqual({ choices: ["撬 [力量✗]"], skill: "力量", difficulty: 10 });
  // Every retry re-enters main (a new visit count), so the loop ends by the spot cap, not the step budget.
  expect(r.truncated).toBe(false);
  expect(r.endings.map((e) => e.choices.join(" > "))).toContain("撬 [力量✗] > 走");
});

test("bands picks which outcomes to walk", async () => {
  const r = exploreStory(await story(GAME("*")), { game: CONFIG, bands: [4, 3, 2, 1, 0] });
  const marks = r.endings.map((e) => e.choices[0]).filter((c) => c.startsWith("撬"));
  expect(marks).toHaveLength(5);
  expect(marks).toEqual(expect.arrayContaining(["撬 [力量✓]", "撬 [力量✓✓]", "撬 [力量✗]", "撬 [力量✗✗]", "撬 [力量~]"]));
  expect(r.checks?.walked).toBe(5);
});

test("a state reached before is not expanded again: a room poked around in any order is explored once per set of things done", async () => {
  const s = await story([
    "VAR got = ()",
    "LIST things = a, b, c",
    "-> room",
    "=== room ===",
    "Room.",
    "* [Take a]",
    "  ~ got += a",
    "  -> room",
    "* [Take b]",
    "  ~ got += b",
    "  -> room",
    "* [Take c]",
    "  ~ got += c",
    "  -> room",
    "+ [Leave] -> END",
  ].join("\n"));
  const r = exploreStory(s);
  // 8 subsets of {a, b, c}, not 16 orderings; every ending is still reached.
  expect(r.endings).toHaveLength(8);
  expect(r.endings.map((e) => e.choices.join(" > "))).toContain("Take a > Take c > Leave");
  expect(r.endings.map((e) => e.choices.join(" > "))).not.toContain("Take c > Take a > Leave");
  expect(r.truncated).toBe(false);
  expect(r.cappedSpots).toBe(0);
});
