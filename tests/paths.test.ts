import { describe, expect, test } from "vitest";
import { resolveInclude, scanIncludes } from "../src/compile/paths";

describe("resolveInclude", () => {
  test("resolves a nested include relative to the root folder", () => {
    expect(resolveInclude("stories/main.ink", "ch1/a.ink")).toBe("stories/ch1/a.ink");
  });
  test("collapses .. segments", () => {
    expect(resolveInclude("stories/main.ink", "../shared.ink")).toBe("shared.ink");
  });
  test("root at vault top level", () => {
    expect(resolveInclude("main.ink", "a.ink")).toBe("a.ink");
  });
  test("keeps Chinese folder and file names with spaces", () => {
    expect(resolveInclude("故事/主.ink", "第一章 开场.ink")).toBe("故事/第一章 开场.ink");
  });
});

describe("scanIncludes", () => {
  test("finds includes, trims, allows indent, ignores commented ones", () => {
    expect(scanIncludes("INCLUDE a.ink\n  INCLUDE b.ink  \n// INCLUDE c.ink\nText")).toEqual(["a.ink", "b.ink"]);
  });
  test("strips CRLF carriage returns", () => {
    expect(scanIncludes("INCLUDE a.ink\r\nINCLUDE b.ink\r\n")).toEqual(["a.ink", "b.ink"]);
  });
  test("keeps Chinese names with spaces", () => {
    expect(scanIncludes("INCLUDE 第一章 开场.ink")).toEqual(["第一章 开场.ink"]);
  });
});
