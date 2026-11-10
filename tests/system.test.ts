import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { Story } from "inkjs/full";
import { compileStory } from "../src/compile/compile";
import { generateInk } from "../src/game/inkgen";
import { GameEngine } from "../src/game/engine";
import { splitNote } from "../src/game/frontmatter";
import { joinPath, layerSystem, systemRef, withSystem } from "../src/game/system";
import { PlaySession } from "../src/play/session";
import { loadGameConfig } from "../scripts/game-note";

const FIXTURE = join(__dirname, "fixtures", "system-pack");

describe("rule-system packs", () => {
  test("a game names its pack by path, with or without a version", () => {
    expect(systemRef({ system: "../../系统/地城/" })).toEqual({ path: "../../系统/地城" });
    expect(systemRef({ system: { path: "../packs/crawl", version: 1 } })).toEqual({ path: "../packs/crawl", version: "1" });
    expect(systemRef({ system: "" })).toBeNull();
    expect(systemRef({ rules: {} })).toBeNull();
    expect(joinPath("../../a/./b/../c")).toBe("../../a/c");
    expect(joinPath("x/y/../../../z")).toBe("../z");
    expect(joinPath("/abs/p/../q")).toBe("/abs/q");
  });

  test("the pack goes under the game: lists joined by id (the game's entry wins), anything else the game sets replaces the pack's", () => {
    const pack = {
      version: "2.1",
      rules: { kind: "sum", dice: [6, 6] },
      languages: ["zh", "en"],
      skills: [{ id: "might" }, { id: "wits" }],
      tables: [{ id: "lair", from: "表/lair.md" }, { id: "loot", rows: [{ text: "gold" }] }],
      decks: [{ id: "fate", from: "牌", cards: [{ id: "a", image: "pics/a.png" }] }],
      map: { image: "map.png", places: [] },
      dungeon: { width: 10, height: 10, from: "./rooms.md", shapes: [] },
    };
    const game = { system: "../../packs/crawl", skills: [{ id: "wits", name: "Brains" }, { id: "luck" }], rules: { kind: "rollUnder" }, languages: ["en"] };
    const out = layerSystem(pack, game, "../../packs/crawl");
    expect(out.version).toBeUndefined();
    expect(out.system).toBe("../../packs/crawl");
    expect(out.skills).toEqual([{ id: "might" }, { id: "wits", name: "Brains" }, { id: "luck" }]);
    expect(out.rules).toEqual({ kind: "rollUnder" });
    expect(out.languages).toEqual(["en"]);
    // The pack's paths are written relative to the pack and come out relative to the game.
    expect(out.tables).toEqual([{ id: "lair", from: "../../packs/crawl/表/lair.md" }, { id: "loot", rows: [{ text: "gold" }] }]);
    expect(out.decks).toEqual([{ id: "fate", from: "../../packs/crawl/牌", cards: [{ id: "a", image: "../../packs/crawl/pics/a.png" }] }]);
    expect((out.map as { image: string }).image).toBe("../../packs/crawl/map.png");
    expect((out.dungeon as { from: string }).from).toBe("../../packs/crawl/rooms.md");
  });

  test("a pack that is not there, or of another major version, is a problem; rules.ink is found", async () => {
    const files: Record<string, string> = {
      "packs/a/system.md": "---\nversion: \"2.0\"\nskills: [{ id: might }]\n---\n",
      "packs/a/rules.ink": "=== fight ===\n->->\n",
      "packs/b/system.md": "---\nskills: [{ id: wits }]\n---\n",
    };
    const read = async (p: string) => files[p] ?? null;
    const run = (fm: unknown) => withSystem(fm, "games/one/", read, parseYaml, splitNote);
    expect(await run({ system: "../../packs/none" })).toMatchObject({ problems: [{ code: "systemMissing", args: ["../../packs/none"] }], files: ["packs/none/system.md"] });
    const a = await run({ system: { path: "../../packs/a", version: "1" } });
    expect(a.problems).toEqual([{ code: "systemVersion", args: ["../../packs/a", "1", "2.0"] }]);
    expect(a.rules).toBe("../../packs/a/rules.ink");
    expect((a.frontmatter as { skills: unknown }).skills).toEqual([{ id: "might" }]);
    expect((await run({ system: { path: "../../packs/a", version: "2.3" } })).problems).toEqual([]);
    const b = await run({ system: "../../packs/b" });
    expect(b.problems).toEqual([]);
    expect(b.rules).toBeUndefined();
    // No pack named: the frontmatter as it is.
    expect(await run({ skills: [] })).toEqual({ frontmatter: { skills: [] }, problems: [], files: [] });
  });

  test("a note table's spawn column is checked like rows written in the note", async () => {
    const { resolveConfig } = await import("../src/game/resolve");
    const { readConfig } = await import("../src/game/config");
    const config = readConfig({ rules: { kind: "sum", dice: [6] }, skills: [{ id: "s" }], characters: [{ id: "c" }], kinds: [{ id: "foe", stats: [{ id: "life" }], templates: [{ id: "rat" }] }], tables: [{ id: "lair", from: "lair.md" }] }).config!;
    const md = "| d6 | text | spawn | count |\n|---|---|---|---|\n| 1-3 | rats | rat | d3 |\n| 4-6 | a dragon | dragon | 1 |\n";
    const r = await resolveConfig(config, { read: async (p) => (p === "lair.md" ? md : null), notes: async () => null }, "");
    expect(r.config.tables?.[0].rows?.map((x) => [x.spawn, x.count])).toEqual([["rat", "d3"], ["dragon", 1]]);
    expect(r.problems).toEqual([{ code: "rowSpawn", args: ["lair", "2", "dragon"] }]);
  });

  test("a game on a pack: the config layered, the pack's note table read, its rules INCLUDEd by the engine, and it plays", async () => {
    const main = join(FIXTURE, "games", "cave", "main.ink");
    const loaded = await loadGameConfig(main);
    expect(loaded?.problems).toEqual([]);
    const config = loaded!.config!;
    expect(config.systemRules).toBe("../../packs/crawl/rules.ink");
    // The game's own resource replaced the pack's; the pack's table came from its note, spawn column and all.
    expect(config.resources).toEqual([{ id: "hp", name: "Health", min: 0, max: 9, initial: 9 }]);
    expect(config.tables?.[0].rows?.map((r) => [r.range, r.id, r.spawn])).toEqual([["1-4", "rats", "rat"], ["5-6", "ogre", "ogre"]]);
    const engineInk = generateInk(config);
    expect(engineInk.split("\n")[1]).toBe("INCLUDE ../../packs/crawl/rules.ink");
    const dir = join(FIXTURE, "games", "cave");
    const compiled = await compileStory("main.ink", (p) => (p === "_engine.ink" ? Promise.resolve(engineInk) : readFile(join(dir, p), "utf8")));
    expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const engine = new GameEngine(config);
      engine.language = "en";
      const s = new PlaySession(new Story(compiled.story!.ToJson() as string), { setup: (st) => engine.setup(st, "hero"), prepare: (st) => engine.seed(st, seed) });
      s.start();
      expect(s.log[0].text).toMatch(/^In the cave: (rats|an ogre)\.$/);
      outcomes.add(s.log.at(-1)!.text.replace(/\d+/, "n"));
    }
    expect([...outcomes].every((o) => o === "Won with n left." || o === "Lost.")).toBe(true);
  });

  test.each([
    ["dungeon-crawl", "crew"],
    ["turn-battle", "party"],
    ["narrative-check", "me"],
  ])("the %s pack: the template's engine is current, it compiles and plays to an ending in both languages", async (pack, who) => {
    const dir = join(__dirname, "..", "packs", pack, "template");
    const loaded = await loadGameConfig(join(dir, "main.ink"));
    expect(loaded?.problems).toEqual([]);
    const config = loaded!.config!;
    expect(config.systemRules).toBe("../rules.ink");
    expect(await readFile(join(dir, "_engine.ink"), "utf8")).toBe(generateInk(config));
    const compiled = await compileStory("main.ink", (p) => readFile(join(dir, p), "utf8"));
    expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const json = compiled.story!.ToJson() as string;
    for (const lang of ["zh", "en"]) {
      for (let seed = 1; seed <= 4; seed++) {
        const engine = new GameEngine(config);
        engine.language = lang;
        const s = new PlaySession(new Story(json), { setup: (st) => engine.setup(st, who), prepare: (st) => engine.seed(st, seed) });
        let step = s.start();
        for (let i = 0; i < 300 && step.choices.length > 0; i++) {
          const back = step.choices.findIndex((c) => /回头|Turn back/.test(c.text));
          const pick = step.choices.filter((_, k) => k !== back)[(seed + i) % (step.choices.length - (back >= 0 ? 1 : 0))];
          step = s.choose(pick.index);
          expect(step.errors).toEqual([]);
        }
        expect(step.ended).toBe(true);
      }
    }
  });

  test("the turn-battle pack: a 3 on 3 battle, everyone acting once a round, fastest first", async () => {
    const dir = join(__dirname, "..", "packs", "turn-battle", "template");
    const config = (await loadGameConfig(join(dir, "main.ink")))!.config!;
    const compiled = await compileStory("main.ink", (p) => readFile(join(dir, p), "utf8"));
    const engine = new GameEngine(config);
    engine.language = "en";
    const s = new PlaySession(new Story(compiled.story!.ToJson() as string), { language: "en", setup: (st) => engine.setup(st, "party"), prepare: (st) => engine.seed(st, 3) });
    const texts: string[] = [];
    const guard = (step: { paragraphs: { text: string }[]; choices: { text: string; index: number }[] }) => {
      texts.push(...step.paragraphs.map((p) => p.text));
      const pick = step.choices.find((c) => / guard$/.test(c.text))!;
      texts.push(`> ${pick.text}`);
      return s.choose(pick.index);
    };
    let step = s.start();
    expect(engine.hud().kinds?.[0].entities.map((e) => e.name)).toEqual(["Goblin", "Orc", "Shaman"]);
    // Round 1, by speed: goblin 5, mage 4, knight 3, shaman 3 (a hero first), cleric 2, orc 1.
    for (let i = 0; i < 3; i++) step = guard(step);
    texts.push(...step.paragraphs.map((p) => p.text));
    const turns = texts.filter((t) => /^(— Round|> |Goblin |Orc |Shaman |\w+'s turn)/.test(t)).map((t) => t.replace(/ \(HP.*$/, "").replace(/ at \w+\.$| at \w+: poisoned\.$/, ""));
    expect(turns.slice(0, 11)).toEqual([
      "— Round 1 —", "Goblin lunges", "Mage's turn", "> Mage: guard", "Knight's turn", "> Knight: guard",
      "Shaman breathes green smoke", "Cleric's turn", "> Cleric: guard", "Orc lunges", "— Round 2 —",
    ]);
    // Round 2 opens with the goblin again, then the mage: her art is offered, the knight's and the cleric's are not.
    const offered = step.choices.map((c) => c.text);
    expect(offered).toContain("Mage: fireball (every foe, 3 MP)");
    expect(offered.filter((t) => /bash|mend/.test(t))).toEqual([]);
    expect(offered.filter((t) => /attack/.test(t))).toHaveLength(3);
  });
});
