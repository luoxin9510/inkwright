import { describe, expect, test } from "vitest";
import { parseRaw, translate } from "../src/compile/diagnostics";

describe("parseRaw", () => {
  test("error with file and line", () => {
    expect(parseRaw("ERROR: 'a.ink' line 3: Expected closing ')'")).toEqual({
      severity: "error", file: "a.ink", line: 3, text: "Expected closing ')'",
    });
  });
  test("warning with line only", () => {
    expect(parseRaw("WARNING: line 7: foo")).toEqual({ severity: "warning", file: null, line: 7, text: "foo" });
  });
  test("todo", () => {
    expect(parseRaw("TODO: line 2: fix").severity).toBe("todo");
  });
  test("message without prefix uses the fallback severity", () => {
    expect(parseRaw("Compilation failed.")).toEqual({
      severity: "error", file: null, line: null, text: "Compilation failed.",
    });
  });
});

describe("translate", () => {
  test.each([
    ["Recursive INCLUDE detected: 'a.ink' is already open.", "检测到循环引用:'a.ink' 已经在引用链中"],
    ["Failed to load: 'a.ink'.\nError:Error: Cannot open s/a.ink", "无法加载文件:'a.ink'(找不到或无法读取)"],
    ["Expected closing ')'", "缺少右括号 ')'"],
    ["Empty diverts (->) are only valid on choices", "空的跳转 (->) 只能出现在选项里"],
    ["Constant strings cannot contain any logic.", "常量字符串里不能包含逻辑"],
  ])("%s", (en, zh) => {
    expect(translate(en)).toBe(zh);
  });
  test("unknown messages keep the original and get a hint", () => {
    expect(translate("Something unknown")).toBe("Something unknown(暂无中文翻译)");
  });
});
