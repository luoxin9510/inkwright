import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import packs from "virtual:packs";
import { splitNote } from "../src/game/frontmatter";
import { downloadPack, indexText, isPackPath, packFiles, packUrl, parseIndex, PACK_SOURCE } from "../src/templates/install";

const fm = (t: string) => splitNote(t, parseYaml).frontmatter;

describe("installing a rule pack from the web", () => {
  test("every bundled pack names exactly its files (the template's generated engine aside)", () => {
    for (const [id, files] of Object.entries(packs)) {
      const listed = packFiles(fm(files["system.md"]));
      expect(listed, id).not.toBeNull();
      expect([...listed!].sort(), id).toEqual(Object.keys(files).sort());
    }
  });

  test("the index: packs with good ids, once each; names in the reader's language", () => {
    const index = parseIndex(JSON.stringify({ packs: [
      { id: "turn-battle", version: "1.0", name: { zh: "回合战斗", en: "Turn battle" }, description: { zh: "三对三", en: "Three on three" } },
      { id: "turn-battle", version: "9" },
      { id: "../etc", version: "1" },
      { id: "Bad Id" },
      { id: "dice", version: 2 },
      "junk",
    ] }));
    expect(index.map((e) => [e.id, e.version])).toEqual([["turn-battle", "1.0"], ["dice", "2"]]);
    expect(indexText(index[0], "en")).toEqual({ name: "Turn battle", description: "Three on three" });
    expect(indexText(index[1], "zh")).toEqual({ name: "dice", description: "" });
    expect(parseIndex("not json")).toEqual([]);
    expect(parseIndex("{}")).toEqual([]);
  });

  test("paths: relative, inside the pack, nothing hidden or odd", () => {
    for (const p of ["rules.ink", "说明.md", "template/game.md", "表/房间.md"]) expect(isPackPath(p), p).toBe(true);
    for (const p of ["", "/etc/passwd", "../x", "a/../b", "a//b", "./a", ".obsidian/x", "a\\b", "c:x", "a#b", "a?b", 3]) expect(isPackPath(p), String(p)).toBe(false);
    expect(packFiles({ files: ["rules.ink", "system.md", "rules.ink"] })).toEqual(["system.md", "rules.ink"]);
    expect(packFiles({ files: ["../evil"] })).toBeNull();
    expect(packFiles({ files: [] })).toBeNull();
    expect(packFiles({})).toBeNull();
    expect(packUrl(PACK_SOURCE, "turn-battle", "template/说明 1.md")).toBe(`${PACK_SOURCE}turn-battle/template/${encodeURIComponent("说明 1.md")}`);
    expect(packUrl("https://x.test/s", "a", "b")).toBe("https://x.test/s/a/b");
  });

  test("a download fetches system.md, then each file it names; any failure fails the whole download", async () => {
    const site: Record<string, string> = {
      "https://x.test/p/system.md": "---\nversion: \"1.2\"\nfiles: [rules.ink, template/main.ink]\n---\n",
      "https://x.test/p/rules.ink": "=== fight ===\n->->\n",
      "https://x.test/p/template/main.ink": "Hi.\n",
    };
    const asked: string[] = [];
    const fetchText = async (url: string) => {
      asked.push(url);
      if (site[url] === undefined) throw new Error("404");
      return site[url];
    };
    const ok = await downloadPack(fetchText, "https://x.test/", "p", fm);
    expect(ok).toEqual({ ok: true, version: "1.2", files: { "system.md": site["https://x.test/p/system.md"], "rules.ink": site["https://x.test/p/rules.ink"], "template/main.ink": "Hi.\n" } });
    expect(asked).toEqual(["https://x.test/p/system.md", "https://x.test/p/rules.ink", "https://x.test/p/template/main.ink"]);
    delete site["https://x.test/p/rules.ink"];
    expect(await downloadPack(fetchText, "https://x.test/", "p", fm)).toEqual({ ok: false, error: "fetch", detail: "rules.ink: 404" });
    site["https://x.test/p/system.md"] = "---\nfiles: [../../.obsidian/plugins/x/main.js]\n---\n";
    expect(await downloadPack(fetchText, "https://x.test/", "p", fm)).toEqual({ ok: false, error: "files", detail: "system.md" });
    expect(await downloadPack(fetchText, "https://x.test/", "../p", fm)).toMatchObject({ ok: false, error: "id" });
    expect(await downloadPack(fetchText, "https://x.test/", "none", fm)).toMatchObject({ ok: false, error: "fetch" });
  });
});
