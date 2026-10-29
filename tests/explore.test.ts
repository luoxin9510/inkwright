import { expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { exploreStory } from "../src/play/explore";

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
  const r = exploreStory(s, { maxSteps: 50 });
  expect(r.truncated).toBe(true);
  expect(r.endings.length).toBeGreaterThan(0);
});

test("plays a bilingual story in the given language", async () => {
  const s = await story('VAR lang = "en"\n* [{lang == "zh": 走|Go}] -> END');
  expect(exploreStory(s, { language: "zh" }).endings[0].choices).toEqual(["走"]);
});
