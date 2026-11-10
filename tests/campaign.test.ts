import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readConfig, type GameConfig } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { splitNote } from "../src/game/frontmatter";
import { generateInk } from "../src/game/inkgen";
import { resolveConfig } from "../src/game/resolve";
import { sheetName, sheetNote, sheetOf } from "../src/game/sheet";
import { PlaySession } from "../src/play/session";

// RPG R5: levels, perks as items, a character sheet written at the end of one adventure and read by the next.
const RULES = {
  rules: { kind: "sum", dice: [6, 6] },
  skills: [{ id: "might" }],
  resources: [{ id: "xp", min: 0, max: 99, initial: 0 }, { id: "life", min: 0, max: 9, initial: 6 }],
  levels: { resource: "xp", at: [0, 5, 12] },
  slots: [{ id: "weapon" }],
  items: [{ id: "sword", slot: "weapon", modifiers: { might: 1 } }, { id: "axe", slot: "weapon", modifiers: { might: 2 } }, { id: "tough", name: { zh: "坚韧", en: "Tough" } }, { id: "arrow", stack: true }],
  statuses: [{ id: "scar" }],
};
const FIRST = readConfig({ ...RULES, characters: [{ id: "hero", name: { zh: "阿岚", en: "Lan" }, skills: { might: 1 }, items: ["sword"], counts: { arrow: 5 } }], sheets: "../角色" }).config as GameConfig;

const ADVENTURE_ONE = `-> start
${generateInk(FIRST)}
=== start ===
Level {level}, next at {next_level_at()}, ready {level_up_ready()}.
~ xp += 6
~ take(arrow, 2)
~ life -= 2
Ready {level_up_ready()}.
+ [Take the level]
    ~ temp up = level_up()
    ~ might += 1
    ~ give(tough, 1)
    ~ equip(axe)
    ~ add_status("me", "scar", 0)
    Up {up}: level {level}, next at {next_level_at()}, ready {level_up_ready()}.
    The end. #sheet
    -> END
`;

const play = (src: string, config: GameConfig, who: string) => {
  const engine = new GameEngine(config);
  engine.language = "en";
  const s = new PlaySession(new Compiler(src).Compile(), { setup: (st) => engine.setup(st, who), prepare: (st) => engine.seed(st, 1) });
  return { s, engine, read: (n: string) => (s as unknown as { story: { variablesState: Record<string, unknown> } }).story.variablesState[n] };
};

describe("levels and a campaign of two adventures", () => {
  test("levels: the config reads; a threshold list that does not rise and an unknown experience resource are problems", () => {
    expect(readConfig({ ...RULES, characters: [{ id: "a", skills: {} }] }).problems).toEqual([]);
    const bad = readConfig({ ...RULES, levels: { resource: "gold", at: [0, 5, 5] }, characters: [{ id: "a", skills: {}, level: 4, resources: { mana: 1 } }] });
    expect(bad.problems.map((p) => p.code).sort()).toEqual(["characterLevel", "characterResource", "levelsOrder", "levelsResource"]);
    // A folder of sheets stands for the characters until the config is resolved.
    expect(readConfig({ ...RULES, characters: { from: "../角色" } }).problems).toEqual([]);
  });

  test("the first adventure levels up, and the sheet carries the hero to the second", async () => {
    const one = play(ADVENTURE_ONE, FIRST, "hero");
    const start = one.s.start();
    expect(start.paragraphs.map((p) => p.text)).toEqual(["Level 1, next at 5, ready false.", "Ready true."]);
    expect(one.engine.hud().level).toEqual({ level: 1, next: 5, ready: true });
    const end = one.s.choose(0);
    expect(end.paragraphs.map((p) => p.text)).toEqual(["Up true: level 2, next at 12, ready false.", "The end."]);
    expect(end.paragraphs.at(-1)?.tags).toEqual(["sheet"]);

    const sheet = sheetOf(FIRST, one.read, "hero")!;
    expect(one.engine.sheet()).toEqual(sheet);
    expect(sheet).toEqual({
      id: "hero", name: { zh: "阿岚", en: "Lan" }, skills: { might: 2 }, items: ["sword", "axe", "tough"], equipped: ["axe"], counts: { arrow: 3 },
      level: 2, resources: { xp: 6, life: 4 }, statuses: { scar: 0 },
    });
    expect(sheetName(sheet, "zh")).toBe("阿岚");

    // The next adventure reads the sheets folder: the note as the plugin writes it (YAML frontmatter, an epilogue).
    const note = `---\n${stringifyYaml(sheet)}---\n\nThe end.\n`;
    const second = readConfig({ ...RULES, characters: { from: "../角色" } }).config as GameConfig;
    const notes = async (folder: string) => (folder === "角色" ? [{ path: "角色/阿岚.md", name: "阿岚", ...splitNote(note, parseYaml) } as never] : null);
    const resolved = await resolveConfig(second, { read: async () => null, notes }, "冒险二/");
    expect(resolved.problems).toEqual([]);
    expect(resolved.files).toEqual(["角色", "角色/阿岚.md"]);
    expect(resolved.config.characters.map((c) => c.id)).toEqual(["hero"]);

    const two = play(`-> start\n${generateInk(resolved.config)}\n=== start ===\nLevel {level}, might {might}, xp {xp}, life {life}, arrows {inv_count(arrow)}, tough {inv ? tough}, worn {equipped}, scar {has_status("me", "scar")}.\n-> END\n`, resolved.config, "hero");
    expect(two.s.start().paragraphs.map((p) => p.text)).toEqual(["Level 2, might 2, xp 6, life 4, arrows 3, tough true, worn axe, scar true."]);
  });

  test("an empty or missing sheets folder is a problem", async () => {
    const second = readConfig({ ...RULES, characters: { from: "../角色" } }).config as GameConfig;
    const r = await resolveConfig(second, { read: async () => null, notes: async () => null }, "冒险二/");
    expect(r.problems.map((p) => p.code)).toEqual(["charactersFolder"]);
  });

  test("the sheet note: frontmatter replaced, the old body kept, the epilogue added under the adventure's name", () => {
    const first = sheetNote("id: hero\nlevel: 1\n", "", "The end.", "Marsh", "2026-11-10 20:00");
    expect(first).toBe("---\nid: hero\nlevel: 1\n---\n\n## Marsh · 2026-11-10 20:00\n\nThe end.\n");
    const again = sheetNote("id: hero\nlevel: 2", splitNote(first, parseYaml).body, "", "Crypt", "2026-11-11 09:00");
    expect(again).toBe("---\nid: hero\nlevel: 2\n---\n\n## Marsh · 2026-11-10 20:00\n\nThe end.\n\n## Crypt · 2026-11-11 09:00\n");
  });
});
