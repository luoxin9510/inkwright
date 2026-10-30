import { describe, expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { playScript } from "../src/play/script";

const SRC = [
  "VAR gold = 0",
  "Start.",
  "* [Dig] You dig. #sfx:dig",
  "  ~ gold += 5",
  "  -> shop",
  "* [Leave] -> END",
  "=== shop ===",
  "Gold: {gold}.",
  "+ [Buy] Bought.",
  "  ~ gold -= 1",
  "  -> shop",
  "+ [Go home] -> END",
].join("\n");

async function story() {
  return (await compileStory("main.ink", async () => SRC)).story!;
}

describe("playScript", () => {
  test("plays choices given by index and records a transcript", async () => {
    const r = playScript(await story(), { choices: [0, 0] });
    expect(r.transcript).toEqual([
      { type: "text", text: "Start.", tags: [] },
      { type: "choice", index: 0, text: "Dig" },
      { type: "text", text: "You dig.", tags: ["sfx:dig"] },
      { type: "text", text: "Gold: 5.", tags: [] },
      { type: "choice", index: 0, text: "Buy" },
      { type: "text", text: "Bought.", tags: [] },
      { type: "text", text: "Gold: 4.", tags: [] },
    ]);
    expect(r.choices).toEqual([{ index: 0, text: "Buy", tags: [] }, { index: 1, text: "Go home", tags: [] }]);
    expect(r.ended).toBe(false);
    expect(r.variables).toContainEqual({ name: "gold", value: "4" });
    // Diverting to a knot from inside itself does not count as a new visit in ink.
    expect(r.visits).toContainEqual({ path: "shop", count: 1 });
    expect(r.turns).toBe(2);
    expect(r.errors).toEqual([]);
  });

  test("choices can be given by text (exact first, then substring)", async () => {
    const r = playScript(await story(), { choices: ["Dig", "home"] });
    expect(r.ended).toBe(true);
    expect(r.transcript.filter((e) => e.type === "choice").map((e) => e.text)).toEqual(["Dig", "Go home"]);
  });

  test("can start from a knot", async () => {
    const r = playScript(await story(), { from: "shop" });
    expect(r.transcript[0]).toEqual({ type: "text", text: "Gold: 0.", tags: [] });
  });

  test("an unmatched choice stops with an error listing what was available", async () => {
    const r = playScript(await story(), { choices: ["Fly"] });
    expect(r.errors[0]).toContain("Fly");
    expect(r.errors[0]).toContain("Dig");
    expect(r.choices.map((c) => c.text)).toEqual(["Dig", "Leave"]);
  });

  test("choosing after the story ended is reported", async () => {
    const r = playScript(await story(), { choices: ["Leave", 0] });
    expect(r.ended).toBe(true);
    expect(r.errors.length).toBe(1);
  });
});
