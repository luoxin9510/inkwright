import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { compileStory } from "../src/compile/compile";
import { readConfig, validateConfig } from "../src/game/config";
import { splitNote } from "../src/game/frontmatter";
import { generateInk } from "../src/game/inkgen";
import { simulateStory } from "../src/play/simulate";
import { journalTemplate } from "../src/templates/journal";

describe.each(["zh", "en"] as const)("the journal template (%s)", (lang) => {
  const t = journalTemplate(lang, lang === "zh" ? "旅途日记" : "Road journal");

  test("its game note reads cleanly and its story compiles with the generated engine", async () => {
    const read = readConfig(splitNote(t.files["game.md"], parseYaml).frontmatter);
    expect(JSON.stringify(read.problems)).toBe("[]");
    const config = read.config!;
    expect(validateConfig(config)).toEqual([]);
    const files: Record<string, string> = { ...t.files, "_engine.ink": generateInk(config) };
    const result = await compileStory("main.ink", async (p) => {
      const f = files[p];
      if (f === undefined) throw new Error("missing " + p);
      return f;
    });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.story).not.toBeNull();

    // Played at random with real dice: every run gets to the end of the road, with no errors, in six days.
    const sim = simulateStory(result.story!, { runs: 20, seed: 3, game: config });
    expect(sim.errors).toEqual([]);
    expect(sim.truncated).toBe(0);
    expect(sim.stuck).toBe(0);
    expect(sim.endings.map((e) => e.lastText)).toHaveLength(1);
    expect(sim.endings[0].lastText).toContain(lang === "zh" ? "第 6 天傍晚" : "day 6");
    // The prompts come from the table, more than one of them.
    expect(sim.tables?.[0].rows.filter((r) => r.count > 0).length).toBeGreaterThan(1);
  });

  test("the story links to the guide note it comes with", () => {
    expect(t.files[`${t.guide}.md`]).toBeDefined();
    expect(t.files["main.ink"]).toContain(`[[${t.guide}]]`);
  });
});
