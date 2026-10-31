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
  expect(r.checks).toEqual({ walked: 2, noConsequence: [], unknownNeeds: [], lockedOut: [], outOfRange: [] });
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

test("game mode: a choice whose #needs: item is not carried is not played; an unknown item is reported", async () => {
  const src = ["-> main", generateInk(CONFIG), "=== main ===", "口袋。", "* [拿刀]", "    ~ 背包 += 刀", "    -> main",
    "* [捅 #needs:刀]", "    捅了。", "    -> END", "* [开枪 #needs:枪]", "    -> END", "+ [走] -> END"].join("\n");
  const r = exploreStory(await story(src), { game: CONFIG, character: "昕" });
  const paths = r.endings.map((e) => e.choices.join(" > "));
  expect(paths).toContain("拿刀 > 捅");
  expect(paths).not.toContain("捅");
  expect(paths.some((p) => p.includes("开枪"))).toBe(false);
  expect(r.checks?.unknownNeeds).toEqual([{ choice: "开枪", item: "枪" }]);
  expect(r.checks?.lockedOut).toEqual([]);
});

test("game mode: a spot where every choice needs something not carried is reported as stuck", async () => {
  const src = ["-> main", generateInk(CONFIG), "=== main ===", "口袋。", "* [走]", "    门。", "    * * [捅 #needs:刀]", "        -> END"].join("\n");
  const r = exploreStory(await story(src), { game: CONFIG, character: "昕" });
  expect(r.endings).toEqual([]);
  expect(r.checks?.lockedOut).toEqual([{ choices: ["走"] }]);
});

test("novelty keeps the counting path the spot cap loses: a resource worn down to its threshold", async () => {
  const s = await story([
    "VAR n = 0",
    "-> loop",
    "=== loop ===",
    "+ [wait]",
    "    ~ n += 1",
    "    { n >= 12: Done. -> END }",
    "    -> loop",
  ].join("\n"));
  const capped = exploreStory(s);
  expect(capped.endings).toEqual([]);
  expect(capped.cappedSpots).toBe(1);
  const r = exploreStory(s, { novelty: true });
  expect(r.endings).toEqual([{ choices: Array<string>(12).fill("wait"), lastText: "Done." }]);
  expect(r.truncated).toBe(false);
  expect(r.cappedSpots).toBe(0);
});

test("novelty ignores what only changes the text: a loop that counts only for show ends at once", async () => {
  const s = await story([
    "VAR t = 0",
    "-> loop",
    "=== loop ===",
    "Seen {t}.",
    "+ [again]",
    "    ~ t += 1",
    "    -> loop",
    "+ [leave] -> END",
  ].join("\n"));
  const r = exploreStory(s, { novelty: true });
  expect(r.endings).toEqual([{ choices: ["leave"], lastText: "Seen 0." }]);
  expect(r.truncated).toBe(false);
});

test("coverage lists the places and choices never got to", async () => {
  const s = await story([
    "-> k",
    "=== k ===",
    "* [a] -> END",
    "* {false} [never] -> END",
    "=== orphan ===",
    "Lost. -> END",
  ].join("\n"));
  const r = exploreStory(s);
  expect(r.coverage.places).toEqual({ total: 2, reached: ["k"], missed: ["orphan"] });
  expect(r.coverage.choices).toEqual({ total: 2, offered: 1, taken: 1, missed: [{ place: "k", text: null }] });
});

test("game mode: a resource outside its range is reported once each way; the engine's functions are not places", async () => {
  const r = exploreStory(await story([
    "-> main",
    generateInk(CONFIG),
    "=== main ===",
    "* [吓]",
    "    ~ 恐惧 += 200",
    "    -> main",
    "* [走] -> END",
  ].join("\n")), { game: CONFIG, character: "昕" });
  expect(r.checks?.outOfRange).toEqual([{ choices: ["吓"], resource: "恐惧", value: 200, min: 0, max: 100 }]);
  expect(r.coverage.places).toEqual({ total: 1, reached: ["main"], missed: [] });
});

test("novelty: a counter past the last constant it is compared with can grow without being new", async () => {
  const s = await story([
    "VAR r = 0",
    "-> loop",
    "=== loop ===",
    "{ r == 1: One. }",
    "+ [again]",
    "    ~ r += 1",
    "    -> loop",
    "+ [leave] -> END",
  ].join("\n"));
  const r = exploreStory(s, { novelty: true });
  // r = 0, 1 (the threshold) and 2 (past it) are each new; 3 and on are not.
  expect(r.endings.map((e) => e.choices.length)).toEqual([1, 2, 3]);
  expect(r.truncated).toBe(false);
});

test("novelty 2 plays on from a pair seen piecewise: a choice needing a flag from one place and a reading from another", async () => {
  // Depth-first, the corridor is first crossed without the flag, read and unread; then with the
  // flag, unread. Coming back read and flagged, nothing about it is new one at a time, so the
  // office is never entered with both and the choice needing both is never offered.
  const s = await story([
    "VAR erased = false",
    "VAR seen = false",
    "VAR written = false",
    "-> start",
    "=== start ===",
    "+ [erase]",
    "    ~ erased = true",
    "    -> corridor",
    "+ [keep] -> corridor",
    "=== corridor ===",
    "+ [library] -> library",
    "+ [office] -> office",
    "=== library ===",
    "+ [read]",
    "    ~ seen = true",
    "    -> corridor",
    "=== office ===",
    "+ {seen and erased and not written} [write]",
    "    ~ written = true",
    "    -> office",
    "+ [leave] -> END",
  ].join("\n"));
  const one = exploreStory(s, { novelty: true });
  expect(one.coverage.choices.missed).toEqual([{ place: "office", text: null }]);
  const two = exploreStory(s, { novelty: 2 });
  expect(two.coverage.choices.missed).toEqual([]);
  expect(two.endings.some((e) => e.choices.includes("write"))).toBe(true);
  expect(two.truncated).toBe(false);
});

test("game mode: a failed check that pushes a resource already at its limit still counts as a consequence", async () => {
  const r = exploreStory(await story([
    "-> start",
    generateInk(CONFIG),
    "=== start ===",
    "~ 恐惧 = 100",
    "-> main",
    "=== main ===",
    "+ [撬 #check:力量:10]",
    '    { 检定("力量", 10) >= 3:',
    "        开了。",
    "        -> END",
    "    - else:",
    "        ~ 恐惧 += 10",
    "    }",
    "    -> main",
    "+ [走] -> END",
  ].join("\n")), { game: CONFIG, character: "昕" });
  expect(r.checks?.noConsequence).toEqual([]);
  expect(r.checks?.outOfRange).toEqual([{ choices: ["撬 [力量✗]"], resource: "恐惧", value: 110, min: 0, max: 100 }]);
});
