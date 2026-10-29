import { describe, expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import type { ReadFile } from "../src/compile/include";

function memory(files: Record<string, string>): ReadFile {
  return async (p) => {
    if (!(p in files)) throw new Error("ENOENT " + p);
    return files[p];
  };
}

describe("compileStory", () => {
  test("compiles a single file", async () => {
    const r = await compileStory("main.ink", memory({ "main.ink": "Hello\n-> END" }));
    expect(r.ok).toBe(true);
    expect(r.story!.Continue()).toBe("Hello\n");
    expect(r.diagnostics).toEqual([]);
    expect(r.files).toEqual(["main.ink"]);
  });

  test("reports a translated-or-hinted error with file and line", async () => {
    const r = await compileStory("main.ink", memory({ "main.ink": "-> nowhere" }));
    expect(r.ok).toBe(false);
    expect(r.story).toBeNull();
    expect(r.diagnostics[0]).toMatchObject({ severity: "error", file: "main.ink", line: 1 });
    expect(r.diagnostics[0].message).not.toMatch(/^ERROR:/);
  });

  test("compiles INCLUDEd files", async () => {
    const r = await compileStory("s/main.ink", memory({
      "s/main.ink": "INCLUDE ch1/a.ink\n-> a",
      "s/ch1/a.ink": "=== a ===\nA text\n-> END",
    }));
    expect(r.ok).toBe(true);
    expect(r.files).toEqual(expect.arrayContaining(["s/main.ink", "s/ch1/a.ink"]));
    expect(r.story!.Continue()).toBe("A text\n");
  });

  test("attributes errors in an included file to that file", async () => {
    const r = await compileStory("s/main.ink", memory({
      "s/main.ink": "INCLUDE ch1/a.ink\n-> a",
      "s/ch1/a.ink": "=== a ===\n-> nowhere",
    }));
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.file === "s/ch1/a.ink" && d.line === 2)).toBe(true);
  });

  test("reports circular INCLUDE in Chinese", async () => {
    const r = await compileStory("main.ink", memory({
      "main.ink": "INCLUDE a.ink\nHi",
      "a.ink": "INCLUDE main.ink",
    }));
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.startsWith("检测到循环引用"))).toBe(true);
  });

  test("reports a missing INCLUDE file in Chinese and tracks it as a dependency", async () => {
    const r = await compileStory("main.ink", memory({ "main.ink": "INCLUDE nope.ink\nHi" }));
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.startsWith("无法加载文件"))).toBe(true);
    expect(r.files).toContain("nope.ink");
  });

  test("an empty file does not throw", async () => {
    const r = await compileStory("main.ink", memory({ "main.ink": "" }));
    expect(Array.isArray(r.diagnostics)).toBe(true);
    expect(Array.isArray(r.files)).toBe(true);
  });

  test("a missing root file yields an error diagnostic", async () => {
    const r = await compileStory("gone.ink", memory({}));
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].severity).toBe("error");
  });
});
