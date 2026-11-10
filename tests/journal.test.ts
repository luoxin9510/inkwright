import { expect, test } from "vitest";
import type { RollRecord } from "../src/game/engine";
import { formatDate, journalPath, renderJournal, rollLine } from "../src/play/journal";

const check: RollRecord = {
  kind: "check", skill: "力量", level: 5, difficulty: 10, modifiers: [{ source: "受伤", value: -2 }], rolls: [3, 4], total: 10, band: 3,
  chance: { success: 0.5, bands: [0, 0.5, 0, 0.5, 0] }, index: 0, turn: 0,
};
const dice: RollRecord = { kind: "dice", formula: "2d6+1", rolls: [2, 5], total: 8, index: 1, turn: 1 };
const table: RollRecord = { kind: "dice", formula: "1d6", rolls: [2], total: 2, index: 2, turn: 1, table: { id: "encounter", name: "遭遇", text: "狼", rowId: "wolf" } };
const bad: RollRecord = { kind: "dice", formula: "lots", rolls: [], total: 0, index: 3, turn: 1, unknown: true };

test("roll lines", () => {
  expect(rollLine(check, "zh", [{ id: "力量", name: "力量" }])).toBe("🎲 力量 10: 3+4 +5 -2 = 10 · 成功");
  expect(rollLine(check, "en", [{ id: "力量", name: "Strength" }])).toBe("🎲 Strength 10: 3+4 +5 -2 = 10 · Success");
  expect(rollLine(dice, "zh")).toBe("🎲 2d6+1: 2+5 = 8");
  expect(rollLine(table, "zh")).toBe("🎲 遭遇 1d6: 2 = 2 · 狼");
  expect(rollLine(bad, "en")).toBe("🎲 lots (bad formula)");
});

test("the note: title, date and character, then the text with each choice and roll where it happened", () => {
  const md = renderJournal({
    title: "302", date: new Date(2026, 10, 1, 21, 5), language: "zh", character: "昕",
    log: [{ text: "门虚掩着。", tags: [] }, { text: "黑不是没开灯的黑。", tags: ["voice:洞察力"] }, { text: "锁开了。", tags: [] }, { text: "一只狼。", tags: [] }],
    turns: [-1, -1, 0, 1],
    choices: [{ text: "撬开门", at: 2 }, { text: "往前走", at: 3 }, { text: "走开", at: 4 }],
    rolls: [check, dice, table],
    voices: [null, "洞察力", null, null],
    skills: [{ id: "力量", name: "力量" }, { id: "洞察力", name: "洞察力" }],
  });
  expect(md).toBe(`# 302

2026-11-01 21:05 · 主角: 昕

门虚掩着。

*洞察力:黑不是没开灯的黑。*

**→ 撬开门**

> 🎲 力量 10: 3+4 +5 -2 = 10 · 成功

锁开了。

**→ 往前走**

> 🎲 2d6+1: 2+5 = 8

> 🎲 遭遇 1d6: 2 = 2 · 狼

一只狼。

**→ 走开**
`);
});

test("a save's text has no turns or choices: the note is just the text", () => {
  const md = renderJournal({ title: "T", date: new Date(2026, 0, 2, 3, 4), language: "en", log: [{ text: "A", tags: [] }, { text: "B", tags: [] }], turns: [null, null], choices: [], rolls: [] });
  expect(md).toBe("# T\n\n2026-01-02 03:04\n\nA\n\nB\n");
  expect(formatDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31 23:59");
});

test("a journal's path: placeholders filled, names cleaned, kept inside the vault, .md added", () => {
  const now = new Date(2026, 10, 10, 9, 5);
  expect(journalPath("{dir}日志/{date} {time}.md", { dir: "游戏/雨夜/", story: "main", character: "昕", now })).toEqual({ path: "游戏/雨夜/日志/2026-11-10 09-05.md", unknown: [] });
  // A story or character name cannot add folders or climb out.
  expect(journalPath("{dir}{story} {character}", { dir: "", story: "a/b:c", character: "../x\u0001", now }).path).toBe("a-b-c --x.md");
  // "." and ".." segments and empty ones are dropped; unknown placeholders are listed and left out.
  expect(journalPath("../../{dir}./日志//{who}{date}", { dir: "g/", story: "s", character: null, now })).toEqual({ path: "g/日志/2026-11-10.md", unknown: ["who"] });
});
