import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import packs from "virtual:packs";
import { splitNote } from "../src/game/frontmatter";
import { systemRef } from "../src/game/system";
import { packGame, packList, relativePath } from "../src/templates/packs";

const fm = (text: string) => splitNote(text, parseYaml).frontmatter;

describe("new games on a pack", () => {
  test("the way from one vault folder to another", () => {
    expect(relativePath("游戏/地城", "规则包/dungeon-crawl")).toBe("../../规则包/dungeon-crawl");
    expect(relativePath("a/b", "a/c")).toBe("../c");
    expect(relativePath("a", "a/p")).toBe("p");
    expect(relativePath("a", "a")).toBe(".");
  });

  test("the bundled packs are listed with their names", () => {
    const zh = packList(packs, "zh", fm);
    expect(zh.map((p) => p.id)).toEqual(["dungeon-crawl", "narrative-check", "turn-battle"]);
    expect(zh.find((p) => p.id === "turn-battle")).toMatchObject({ name: "回合战斗", version: "1.0" });
    expect(packList(packs, "en", fm).find((p) => p.id === "narrative-check")?.name).toBe("Narrative checks");
    expect(zh.find((p) => p.id === "dungeon-crawl")).toMatchObject({ name: "地城爬行", version: "1.1" });
    expect(packList(packs, "en", fm).find((p) => p.id === "dungeon-crawl")?.name).toBe("Dungeon crawl");
    // The template's generated engine is not bundled: the plugin generates it.
    expect(Object.keys(packs["dungeon-crawl"])).not.toContain("template/_engine.ink");
  });

  test("the pack goes to the packs folder, the template to the game's, and system: points from one to the other", () => {
    const out = packGame(packs, "dungeon-crawl", "规则包/dungeon-crawl", "游戏/我的地城")!;
    expect(Object.keys(out.pack)).toEqual(expect.arrayContaining(["规则包/dungeon-crawl/system.md", "规则包/dungeon-crawl/rules.ink"]));
    expect(Object.keys(out.game).sort()).toEqual(["游戏/我的地城/game.md", "游戏/我的地城/main.ink"]);
    expect(systemRef(fm(out.game["游戏/我的地城/game.md"]))).toEqual({ path: "../../规则包/dungeon-crawl", version: "1" });
    expect(packGame(packs, "none", "a", "b")).toBeNull();
  });
});
