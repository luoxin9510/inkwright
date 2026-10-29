import { describe, expect, test } from "vitest";
import { CachedFileHandler, preload, type ReadFile } from "../src/compile/include";

function memory(files: Record<string, string>): ReadFile {
  return async (p) => {
    if (!(p in files)) throw new Error("ENOENT " + p);
    return files[p];
  };
}

describe("preload", () => {
  test("follows nested includes relative to the root folder", async () => {
    const cache = await preload("s/main.ink", memory({
      "s/main.ink": "INCLUDE a.ink",
      "s/a.ink": "INCLUDE sub/b.ink",
      "s/sub/b.ink": "B",
    }));
    expect([...cache.files.keys()]).toEqual(["s/main.ink", "s/a.ink", "s/sub/b.ink"]);
  });
  test("terminates on circular includes", async () => {
    const cache = await preload("s/main.ink", memory({
      "s/main.ink": "INCLUDE a.ink",
      "s/a.ink": "INCLUDE main.ink",
    }));
    expect(cache.files.size).toBe(2);
  });
  test("records missing files without throwing", async () => {
    const cache = await preload("s/main.ink", memory({ "s/main.ink": "INCLUDE nope.ink" }));
    expect([...cache.missing]).toEqual(["s/nope.ink"]);
  });
  test("loads Chinese names with spaces", async () => {
    const cache = await preload("故事/主.ink", memory({
      "故事/主.ink": "INCLUDE 第一章 开场.ink",
      "故事/第一章 开场.ink": "x",
    }));
    expect(cache.files.has("故事/第一章 开场.ink")).toBe(true);
  });
});

describe("CachedFileHandler", () => {
  test("resolves relative to root and loads synchronously from cache", async () => {
    const cache = await preload("s/main.ink", memory({ "s/main.ink": "INCLUDE a.ink", "s/a.ink": "A" }));
    const h = new CachedFileHandler("s/main.ink", cache);
    expect(h.ResolveInkFilename("a.ink")).toBe("s/a.ink");
    expect(h.LoadInkFileContents("s/a.ink")).toBe("A");
  });
  test("throws for files that are not cached", async () => {
    const cache = await preload("s/main.ink", memory({ "s/main.ink": "" }));
    const h = new CachedFileHandler("s/main.ink", cache);
    expect(() => h.LoadInkFileContents("s/nope.ink")).toThrow("Cannot open s/nope.ink");
  });
});
