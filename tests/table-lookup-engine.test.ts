import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { readConfig, type GameConfig } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { PlaySession } from "../src/play/session";

// Every kind of table: ranges out of order, an open bottom and top, single faces, no ranges, d66, text with quotes and braces.
const FM = {
  rules: { kind: "sum", dice: [6, 6] },
  languages: ["zh", "en"],
  skills: [{ id: "wits" }],
  characters: [{ id: "you" }],
  tables: [
    { id: "ranged", rows: [{ range: "4-6", id: "mid", zh: "中间", en: "middle" }, { range: "≤3", id: "low", zh: "低 \"引号\"", en: "low {brace}" }, { range: "7+", id: "high", zh: "高", en: "high   spaced" }] },
    { id: "faces", rows: [{ range: 1, zh: "一", en: "one" }, { range: 2, id: "two", zh: "二", en: "two" }, { range: "3-6", zh: "多", en: "many" }] },
    { id: "plain", rows: [{ zh: "甲", en: "A" }, { id: "b", zh: "乙", en: "B" }, { zh: "丙", en: "C" }] },
    { id: "d66", rows: [{ range: "11-36", id: "first", zh: "前", en: "front" }, { range: "41-66", id: "second", zh: "后", en: "back" }] },
  ],
};

describe("table lookups done by the engine", () => {
  test("give exactly what the generated ink gives, for every total and both languages", () => {
    const game = readConfig(FM).config as GameConfig;
    const tables = game.tables!.map((t) => t.id);
    const totals = Array.from({ length: 73 }, (_, i) => i - 2);
    const lines = (lang: string) => [`~ lang = "${lang}"`, ...tables.flatMap((t) => totals.map((k) => `${t} ${k}: {table_text("${t}", ${k})} / {table_id("${t}", ${k})}`)), `none: {table_text("nope", 1)}/{table_id("nope", 1)}`];
    const src = `-> main\n${generateInk(game)}\n=== main ===\n${[...lines("zh"), ...lines("en")].join("\n")}\n-> END\n`;
    const engine = new GameEngine(game);
    const withEngine = new PlaySession(new Compiler(src).Compile(), { setup: (s) => engine.setup(s, "you") });
    withEngine.start();
    const inkOnly = new PlaySession(new Compiler(src).Compile(), {});
    inkOnly.start();
    expect(withEngine.log.length).toBe(2 * (tables.length * totals.length + 1));
    expect(withEngine.log.map((p) => p.text)).toEqual(inkOnly.log.map((p) => p.text));
    // And they say something: the escaping and the language both show.
    expect(withEngine.log.map((p) => p.text)).toContain("ranged 2: 低 '引号' / low");
    expect(withEngine.log.map((p) => p.text)).toContain("ranged 2: low (brace) / low");
    expect(withEngine.log.map((p) => p.text)).toContain("ranged 9: high spaced / high");
  });

  test("the engine really answers (a config changed after compiling shows in its lookups, not in the ink's)", () => {
    const game = readConfig(FM).config as GameConfig;
    const src = `-> main\n${generateInk(game)}\n=== main ===\n{table_text("plain", 2)}\n-> END\n`;
    const story = new Compiler(src).Compile();
    game.tables![2].rows![1].text = { zh: "改过", en: "changed" };
    const engine = new GameEngine(game);
    const s = new PlaySession(story, { setup: (st) => engine.setup(st, "you") });
    s.start();
    expect(s.log[0].text).toBe("改过");
  });
});
