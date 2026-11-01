import { describe, expect, test } from "vitest";
import { readConfig, validateConfig, type GameConfig, type TableDef } from "../src/game/config";
import { averageFormula, formatFormula, formulaSpan, parseFormula, rollFormula } from "../src/game/dice";
import { generateInk } from "../src/game/inkgen";
import { parseMarkdownTable, parseRange, resolveTables, rowAt, rowsFromMarkdown, tableFormula, tableProblems } from "../src/game/tables";
import { CONFIG } from "./fixtures/gameConfig";

describe("dice formulas", () => {
  test("NdM with a bonus, dM, d%, d66", () => {
    expect(parseFormula("2d6+3")).toEqual({ count: 2, sides: 6, bonus: 3, d66: false });
    expect(parseFormula(" d20 - 1 ")).toEqual({ count: 1, sides: 20, bonus: -1, d66: false });
    expect(parseFormula("D%")).toEqual({ count: 1, sides: 100, bonus: 0, d66: false });
    expect(parseFormula("d66")).toEqual({ count: 2, sides: 6, bonus: 0, d66: true });
    expect(parseFormula("1d66")).toEqual({ count: 1, sides: 66, bonus: 0, d66: false });
    for (const bad of ["", "6", "2d", "d1", "0d6", "2d6+", "1d6x", "two dice"]) expect(parseFormula(bad), bad).toBeNull();
  });
  test("format, span and average", () => {
    const f = parseFormula("2d6+3");
    expect(f && formatFormula(f)).toBe("2d6+3");
    expect(f && formulaSpan(f)).toEqual({ min: 5, max: 15 });
    expect(f && averageFormula(f)).toBe(10);
    const d66 = parseFormula("d66");
    expect(d66 && formatFormula(d66)).toBe("d66");
    expect(d66 && formulaSpan(d66)).toEqual({ min: 11, max: 66 });
    expect(d66 && averageFormula(d66)).toBe(39);
  });
  test("rolling: faces and the total; d66 reads tens and units", () => {
    const faces = (...fs: number[]) => {
      let i = 0;
      return () => (fs[i++] - 1) / 6 + 1e-9;
    };
    const f = parseFormula("2d6+3");
    expect(f && rollFormula(f, faces(3, 4))).toEqual({ rolls: [3, 4], total: 10 });
    const d66 = parseFormula("d66");
    expect(d66 && rollFormula(d66, faces(5, 2))).toEqual({ rolls: [5, 2], total: 52 });
  });
});

const ENCOUNTER: TableDef = {
  id: "encounter",
  name: { zh: "遭遇", en: "Encounter" },
  rows: [
    { range: "4-5", text: { zh: "熊", en: "Bear" } },
    { range: "1-3", text: { zh: "狼", en: "Wolf" }, id: "wolf" },
    { range: "6", text: { zh: "什么都没有", en: "Nothing" } },
  ],
};

describe("tables", () => {
  test("ranges", () => {
    expect(parseRange("1-3")).toEqual({ lo: 1, hi: 3 });
    expect(parseRange("4")).toEqual({ lo: 4, hi: 4 });
    expect(parseRange(" 11 – 16 ")).toEqual({ lo: 11, hi: 16 });
    expect(parseRange(7)).toEqual({ lo: 7, hi: 7 });
    expect(parseRange("3-1")).toBeNull();
    expect(parseRange("a")).toBeNull();
    expect(parseRange(undefined)).toBeNull();
  });
  test("the dice are given, or inferred from the ranges, or one face per row", () => {
    expect(tableFormula(ENCOUNTER)).toEqual({ count: 1, sides: 6, bonus: 0, d66: false });
    expect(tableFormula({ id: "t", dice: "2d6", rows: [] })).toEqual({ count: 2, sides: 6, bonus: 0, d66: false });
    expect(tableFormula({ id: "t", rows: [{ range: "11-36", text: "a" }, { range: "41-66", text: "b" }] })).toEqual({ count: 2, sides: 6, bonus: 0, d66: true });
    expect(tableFormula({ id: "t", rows: [{ range: "1-50", text: "a" }, { range: "51-100", text: "b" }] })).toEqual({ count: 1, sides: 100, bonus: 0, d66: false });
    expect(tableFormula({ id: "t", rows: [{ text: "a" }, { text: "b" }, { text: "c" }] })).toEqual({ count: 1, sides: 3, bonus: 0, d66: false });
    expect(tableFormula({ id: "t", dice: "lots", rows: [] })).toBeNull();
  });
  test("a total lands on the row whose range holds it, or on the total-th row", () => {
    expect(rowAt(ENCOUNTER, 2)).toMatchObject({ index: 1, row: { id: "wolf" } });
    expect(rowAt(ENCOUNTER, 5)).toMatchObject({ index: 0 });
    expect(rowAt(ENCOUNTER, 6)).toMatchObject({ index: 2 });
    expect(rowAt(ENCOUNTER, 7)).toBeNull();
    const plain: TableDef = { id: "t", rows: [{ text: "a" }, { text: "b" }] };
    expect(rowAt(plain, 2)).toMatchObject({ index: 1, row: { text: "b" } });
    expect(rowAt(plain, 3)).toBeNull();
  });
  test("problems: no rows, bad dice, gaps, overlaps, totals outside the dice, a row without text", () => {
    const codes = (t: TableDef) => tableProblems(t).map((p) => `${p.code}${p.args.length > 1 ? ":" + p.args.slice(1).join("|") : ""}`);
    expect(codes(ENCOUNTER)).toEqual([]);
    expect(codes({ id: "t" })).toEqual(["tableRows"]);
    expect(codes({ id: "t", from: "表.md" })).toEqual([]); // checked once the note is read
    expect(codes({ id: "t", rows: [] })).toEqual(["tableRows"]);
    expect(codes({ id: "t", dice: "lots", rows: [{ text: "a" }] })).toEqual(["tableDice:lots"]);
    expect(codes({ id: "t", rows: [{ range: "1-2", text: "a" }, { range: "4-6", text: "b" }] })).toEqual(["tableRange:no row for 3"]);
    expect(codes({ id: "t", rows: [{ range: "1-3", text: "a" }, { range: "3-6", text: "b" }] })).toEqual(["tableRange:two rows for 3"]);
    expect(codes({ id: "t", dice: "1d6", rows: [{ range: "1-3", text: "a" }, { range: "4-8", text: "b" }] })).toEqual(["tableRange:7, 8 outside 1d6 (1..6)"]);
    expect(codes({ id: "t", rows: [{ range: "1-3", text: "a" }, { text: "b" }] })).toEqual(["tableRange:no range on row 2"]);
    expect(codes({ id: "t", dice: "d66", rows: [{ range: "11-36", text: "a" }, { range: "41-66", text: "b" }, { range: "71", text: "c" }] })).toEqual(["tableRange:71 outside d66 (11..66)"]);
    expect(codes({ id: "t", dice: "1d4", rows: [{ text: "a" }, { text: "b" }] })).toEqual(["tableRange:2 rows, 1d4 gives 1..4"]);
    expect(codes({ id: "t", rows: [{ range: "1-6", text: "" }] })).toEqual(["tableRow:1"]);
    expect(codes({ id: "t", dice: "d66", rows: [{ range: "11-33", text: "a" }, { range: "34-66", text: "b" }] })).toEqual([]);
  });
  test("validateConfig: table ids share the namespace and the tables are checked", () => {
    const config: GameConfig = { ...CONFIG, tables: [{ id: "力量", rows: [] }] };
    expect(validateConfig(config).map((p) => p.code)).toEqual(["duplicate", "tableRows"]);
  });
  test("readConfig: rows in full or in the language shorthand, a numeric range, and the journal path", () => {
    const fm = {
      rules: { kind: "sum", dice: [6, 6] }, languages: ["zh", "en"], skills: [{ id: "s" }], characters: [{ id: "c", skills: { s: 1 } }],
      tables: [
        { id: "a", rows: [{ range: "1-3", zh: "狼", en: "Wolf", id: "wolf" }, { range: 4, text: { zh: "熊", en: "Bear" } }, { range: "5-6", text: "无" }] },
        { id: "b", from: "表/b.md", dice: "d100" },
      ],
      journal: { path: "{dir}日志/{date}.md" },
    };
    const { config, problems } = readConfig(fm);
    expect(problems).toEqual([]);
    expect(config?.tables).toEqual([
      { id: "a", rows: [{ range: "1-3", text: { zh: "狼", en: "Wolf" }, id: "wolf" }, { range: "4", text: { zh: "熊", en: "Bear" } }, { range: "5-6", text: "无" }] },
      { id: "b", from: "表/b.md", dice: "d100" },
    ]);
    expect(config?.journal).toEqual({ path: "{dir}日志/{date}.md" });
    expect(readConfig({ ...fm, tables: [{ id: "a", rows: [{ range: "1-3" }] }] }).problems.map((p) => p.code)).toEqual(["shape"]);
    expect(readConfig({ ...fm, journal: "日志" }).problems.map((p) => p.code)).toEqual(["shape"]);
  });
});

describe("tables in notes", () => {
  const NOTE = `# 遭遇

说明文字。

| 1d6 | zh | en | id |
|---|---|---|---|
| 1-3 | 狼 | Wolf | wolf |
| 4-5 | 熊 | Bear | |
| 6 | 什么都没有 | Nothing | |

后面的话。
`;
  test("the first markdown table, cells trimmed, escaped pipes kept", () => {
    expect(parseMarkdownTable(NOTE)).toEqual({
      header: ["1d6", "zh", "en", "id"],
      rows: [["1-3", "狼", "Wolf", "wolf"], ["4-5", "熊", "Bear", ""], ["6", "什么都没有", "Nothing", ""]],
    });
    expect(parseMarkdownTable("| a \\| b | c |\n|---|---|\n| x | y |")).toEqual({ header: ["a | b", "c"], rows: [["x", "y"]] });
    expect(parseMarkdownTable("no table here")).toBeNull();
  });
  test("rows: the range column by header or by its cells, language columns, the id column; a formula header names the dice", () => {
    expect(rowsFromMarkdown(NOTE, ["zh", "en"])).toEqual({
      dice: "1d6",
      rows: [
        { range: "1-3", text: { zh: "狼", en: "Wolf" }, id: "wolf" },
        { range: "4-5", text: { zh: "熊", en: "Bear" } },
        { range: "6", text: { zh: "什么都没有", en: "Nothing" } },
      ],
    });
    expect(rowsFromMarkdown("| 范围 | 结果 |\n|---|---|\n| 1-2 | 晴 |\n| 3-6 | 雨 |", [])).toEqual({ rows: [{ range: "1-2", text: "晴" }, { range: "3-6", text: "雨" }] });
    expect(rowsFromMarkdown("| 点 | 事 |\n|---|---|\n| 1 | 晴 |\n| 2 | 雨 |", [])).toEqual({ rows: [{ range: "1", text: "晴" }, { range: "2", text: "雨" }] });
    expect(rowsFromMarkdown("| 事 |\n|---|\n| 晴 |\n| 雨 |", [])).toEqual({ rows: [{ text: "晴" }, { text: "雨" }] });
    expect(rowsFromMarkdown("nothing", [])).toBeNull();
  });
  test("resolveTables reads each table's note relative to the game folder, checks it, and lists the notes read", async () => {
    const config: GameConfig = { ...CONFIG, tables: [ENCOUNTER, { id: "w", from: "表/天气.md" }, { id: "x", from: "/根/x.md" }, { id: "y", from: "missing.md" }] };
    const notes: Record<string, string> = { "游戏/表/天气.md": "| d66 | zh | en |\n|---|---|---|\n| 11-33 | 晴 | Sun |\n| 34-66 | 雨 | Rain |", "根/x.md": "no table" };
    const r = await resolveTables(config, (p) => Promise.resolve(notes[p] ?? null), "游戏/");
    expect(r.files).toEqual(["游戏/表/天气.md", "根/x.md", "游戏/missing.md"]);
    expect(r.problems).toEqual([{ code: "tableFile", args: ["x", "根/x.md"] }, { code: "tableFile", args: ["y", "游戏/missing.md"] }]);
    expect(r.config.tables?.[1]).toEqual({ id: "w", from: "表/天气.md", dice: "d66", rows: [{ range: "11-33", text: { zh: "晴", en: "Sun" } }, { range: "34-66", text: { zh: "雨", en: "Rain" } }] });
    expect(r.config.tables?.[0]).toBe(ENCOUNTER);
    // Nothing to read: the same config comes back.
    expect((await resolveTables(CONFIG, () => Promise.resolve(null), "")).config).toBe(CONFIG);
  });
});

test("the generated ink declares the dice EXTERNAL, the roll wrapper and one lookup per table row", () => {
  const ink = generateInk({ ...CONFIG, tables: [ENCOUNTER, { id: "天气", rows: [{ text: { zh: "晴", en: "Sun" } }, { text: { zh: "雨", en: "Rain" } }] }] });
  expect(ink).toContain("EXTERNAL 掷骰(公式, 标签)");
  expect(ink).toContain("=== function 掷(公式) ===\n~ return 掷骰(公式, \"\")");
  expect(ink).toContain('{ 公式 == "1d6":\n    ~ return 4\n}');
  expect(ink).toContain('{ 公式 == "1d2":\n    ~ return 2\n}');
  expect(ink).toContain('{ 表名 == "encounter":\n    ~ return 掷骰("1d6", "encounter")\n}');
  // Rows in ascending range order; the last catches the rest.
  expect(ink).toContain('{ 表名 == "encounter" and 点数 <= 3:\n    ~ return 双("狼", "Wolf")\n}\n{ 表名 == "encounter" and 点数 <= 5:\n    ~ return 双("熊", "Bear")\n}\n{ 表名 == "encounter":\n    ~ return 双("什么都没有", "Nothing")\n}');
  expect(ink).toContain('{ 表名 == "天气" and 点数 == 1:\n    ~ return 双("晴", "Sun")\n}\n{ 表名 == "天气":\n    ~ return 双("雨", "Rain")\n}');
  expect(ink).toContain('{ 表名 == "encounter" and 点数 <= 3:\n    ~ return "wolf"\n}');
  expect(ink).toContain("=== function 查表(表名) ===\n~ return 表文(表名, 掷表(表名))");
});
