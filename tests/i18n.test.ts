import { afterEach, describe, expect, test } from "vitest";
import { T, getLanguage, pickLanguage, resolveLanguage, setLanguage } from "../src/i18n";
import { translate } from "../src/compile/diagnostics";
import { compileStory } from "../src/compile/compile";
import { PlaySession } from "../src/play/session";
import { CONFIG_PROBLEM_CODES } from "../src/game/config";

afterEach(() => setLanguage("zh"));

describe("pickLanguage", () => {
  test.each([
    ["zh-cn", "zh"], ["zh-tw", "zh"], ["zh", "zh"], ["en", "en"], ["en-gb", "en"], ["fr", "en"], ["", "en"],
  ])("%s -> %s", (locale, lang) => {
    expect(pickLanguage(locale)).toBe(lang);
  });
});

describe("strings follow the language", () => {
  test("Chinese by default in tests", () => {
    expect(getLanguage()).toBe("zh");
    expect(T().restart).toBe("重新开始");
  });
  test("English after switching", () => {
    setLanguage("en");
    expect(T().restart).toBe("Restart");
    expect(T().lineAt(3)).toBe("line 3");
    expect(T().rootLine("a.ink", true)).toBe("Main story: a.ink (locked)");
  });
  test("Chinese formatting helpers", () => {
    expect(T().lineAt(3)).toBe("第 3 行");
    expect(T().rootLine("a.ink", true)).toBe("主剧本:a.ink(已锁定)");
  });
  test("every English string differs from Chinese and is not empty", () => {
    const zh = T();
    setLanguage("en");
    const en = T();
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      if (typeof zh[key] === "string") {
        expect(en[key], key).not.toBe("");
        expect(en[key], key).not.toBe(zh[key]);
      }
    }
  });
});

describe("game config problems", () => {
  test("every code is worded in both languages, differently, naming its arguments", () => {
    const args = ["甲", "乙", "7", "6"];
    for (const code of CONFIG_PROBLEM_CODES) {
      setLanguage("zh");
      const zh = T().configProblem({ code, args });
      setLanguage("en");
      const en = T().configProblem({ code, args });
      expect(zh, code).not.toBe("");
      expect(en, code).not.toBe(zh);
      if (!["noFrontmatter", "rulesKind", "dice", "sides", "noCharacters", "languages"].includes(code)) {
        expect(zh, code).toContain("甲");
        expect(en, code).toContain("甲");
      }
    }
  });
});

describe("messages in English mode", () => {
  test("compiler errors are shown as the original English text", () => {
    setLanguage("en");
    expect(translate("Unresolved variable: x")).toBe("Unresolved variable: x");
  });
  test("missing main story", async () => {
    setLanguage("en");
    const r = await compileStory("gone.ink", async () => { throw new Error("x"); });
    expect(r.diagnostics[0].message).toBe("Main story not found: gone.ink");
  });
  test("TODO notes", async () => {
    setLanguage("en");
    const r = await compileStory("main.ink", async () => "TODO: finish\n-> END");
    expect(r.diagnostics[0].message).toBe("TODO: finish");
  });
  test("infinite loop guard", async () => {
    setLanguage("en");
    const r = await compileStory("main.ink", async () => "-> a\n=== a ===\nhi\n-> a");
    const step = new PlaySession(r.story!, { timeBudgetMs: 100 }).start();
    expect(step.errors.some((e) => e.includes("infinite loop"))).toBe(true);
  });
});

describe("resolveLanguage", () => {
  test("auto follows the Obsidian locale", () => {
    expect(resolveLanguage("auto", "zh-cn")).toBe("zh");
    expect(resolveLanguage("auto", "en")).toBe("en");
  });
  test("an explicit choice overrides the locale", () => {
    expect(resolveLanguage("zh", "en")).toBe("zh");
    expect(resolveLanguage("en", "zh-cn")).toBe("en");
  });
});

describe("runtime errors in English mode", () => {
  test("are left untouched", async () => {
    setLanguage("en");
    const { translateRuntime } = await import("../src/compile/diagnostics");
    const raw = "RUNTIME ERROR: 'main.ink' line 3: ran out of content. Do you need a '-> DONE' or '-> END'?";
    expect(translateRuntime(raw)).toBe(raw);
  });
});
