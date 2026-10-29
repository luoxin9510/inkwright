import { expect, test } from "vitest";
import { compileStory } from "../src/compile/compile";
import { findUntranslated } from "../src/compile/bilingual";

const lines = (src: string) => findUntranslated(src).map((u) => u.line);

test("text wrapped in a call is translated; bare text is not", () => {
  expect(lines([
    '{双("开始。", "Start.")}',
    "裸文字。",
    '* [{双("开门", "Open")}] -> door',
    "* [开门] -> door",
    '+ (hub) {有钥匙} [{双("用钥匙", "Use key")}] {双("开了。", "Opened.")} #场景:门',
    "- (gather) -> END",
    "<- thread_knot",
  ].join("\n"))).toEqual([2, 4]);
});

test("logic, declarations, comments and tags are not text", () => {
  expect(lines([
    'VAR 语言 = "zh"',
    "CONST 上限 = 3",
    "LIST 背包 = 油灯, 旧信",
    "INCLUDE 第一章.ink",
    "=== 开门 ===",
    "= 楼上",
    "=== function 双(zh, en) ===",
    "~ 信任 += 1",
    "// 注释里的中文",
    "/* 多行",
    "注释 */",
    "{ 语言 == \"en\":",
    "  ~ return en",
    "- else:",
    "  ~ return zh",
    "}",
    "{ 信任 > 1:",
    '  - 信任 > 3: {双("好", "Good")}',
    "  - else: 坏",
    "}",
    "#场景:旅店",
    "-> 开门",
    "TODO: 以后再写",
  ].join("\n"))).toEqual([19]);
});

test("an empty side of a call is reported", () => {
  expect(findUntranslated('{双("开门", "")}')).toEqual([{ line: 1, kind: "empty" }]);
  expect(findUntranslated('{双("", "Open")}')).toEqual([{ line: 1, kind: "empty" }]);
});

test("compile warns about untranslated lines only in bilingual stories", async () => {
  const fn = '=== function 双(zh, en) ===\n{ 语言 == "en":\n  ~ return en\n}\n~ return zh';
  const bilingual = await compileStory("main.ink", async () => `VAR 语言 = "zh"\n{双("好", "Good")}\n裸文字\n-> END\n${fn}`);
  expect(bilingual.ok).toBe(true);
  expect(bilingual.diagnostics.filter((d) => d.severity === "warning").map((d) => d.line)).toEqual([3]);
  const plain = await compileStory("main.ink", async () => "裸文字\n-> END");
  expect(plain.diagnostics).toEqual([]);
});
