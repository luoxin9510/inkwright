import type { ConfigProblem, GameConfig, LocalizedText, TableDef, TableRow } from "./config";
import { formatFormula, formulaSpan, parseFormula, type DiceFormula } from "./dice";

/**
 * Random tables: rows with a dice range each (`1-3`, `4`, `66`) or none (one row per face),
 * written inline in the game note or kept as a markdown table in another note. The engine
 * rolls the table's dice and the generated ink looks the row up, so a story reads
 * `{table("encounter")}` the same with and without the engine.
 */

export interface Range {
  lo: number;
  hi: number;
}

/** `1-3` → 1..3, `4` → 4..4, `11–16` (any dash) likewise; null when the text is not a range. */
export function parseRange(text: string | number | undefined | null): Range | null {
  if (typeof text === "number") return Number.isInteger(text) ? { lo: text, hi: text } : null;
  if (typeof text !== "string") return null;
  // Open ends, for totals a modifier pushes past the dice: `6+` (6 or more), `≤0` / `<=0` (0 or less).
  const up = /^\s*(-?\d+)\s*\+\s*$/.exec(text);
  if (up) return { lo: Number(up[1]), hi: Infinity };
  const down = /^\s*(?:≤|<=)\s*(-?\d+)\s*$/.exec(text);
  if (down) return { lo: -Infinity, hi: Number(down[1]) };
  const m = /^\s*(\d+)\s*(?:[-–—~]\s*(\d+))?\s*$/.exec(text);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] === undefined ? lo : Number(m[2]);
  return hi >= lo ? { lo, hi } : null;
}

/** The ranges of a table's rows, in row order; null entries for rows without one. */
function ranges(table: TableDef): (Range | null)[] {
  return (table.rows ?? []).map((r) => parseRange(r.range));
}

/** Every bound uses only the digits 1..6 with two digits at the top: the table reads like d66. */
function looksD66(rs: Range[]): boolean {
  const ok = (n: number) => n >= 11 && n <= 66 && /^[1-6]+$/.test(String(n));
  return rs.length > 0 && rs.every((r) => ok(r.lo) && ok(r.hi)) && Math.max(...rs.map((r) => r.hi)) === 66;
}

/**
 * The dice a table rolls: its own `dice`, else inferred from the ranges (d66 when they read like
 * it, else one die as big as the top bound), else one die with a face per row. Null when `dice`
 * is given but not a formula.
 */
export function tableFormula(table: TableDef): DiceFormula | null {
  if (table.dice !== undefined) return parseFormula(table.dice);
  const rs = ranges(table).filter((r): r is Range => r !== null);
  if (rs.length === 0) return { count: 1, sides: Math.max(1, table.rows?.length ?? 0), bonus: 0, d66: false };
  if (looksD66(rs)) return { count: 2, sides: 6, bonus: 0, d66: true };
  return { count: 1, sides: Math.max(1, ...rs.map((r) => (Number.isFinite(r.hi) ? r.hi : r.lo))), bonus: 0, d66: false };
}

/** The row a total lands on: by its range, or, in a table without ranges, the total-th row (1-based). Null when none. */
export function rowAt(table: TableDef, total: number): { row: TableRow; index: number } | null {
  const rows = table.rows ?? [];
  const rs = ranges(table);
  if (rs.some((r) => r !== null)) {
    const i = rs.findIndex((r) => r !== null && r.lo <= total && total <= r.hi);
    return i < 0 ? null : { row: rows[i], index: i };
  }
  const i = Math.round(total) - 1;
  return i >= 0 && i < rows.length ? { row: rows[i], index: i } : null;
}

/** A table row's text as it goes into an ink string literal (and as the engine's lookup returns it). */
export function inkText(x: string): string {
  return x.replace(/["{}]/g, (c) => (c === '"' ? "'" : c === "{" ? "(" : ")")).replace(/\s+/g, " ");
}

/** A table row's id as the generated lookup returns it. */
export function inkId(id: string | undefined): string {
  return (id ?? "").replace(/["{}]/g, "");
}

/**
 * How the generated lookups (`table_text`, `table_id`) find a total's row, in the order they test: rows with ranges
 * ascending by their bottom, each taken when `total <= le`; in a table without ranges, row k when `total == eq`. The
 * last row (and an open top) takes the rest. The ink and the engine's binding both follow this, so they agree.
 */
export function lookupOrder(table: TableDef): { row: TableRow; eq?: number; le?: number }[] {
  const all = table.rows ?? [];
  const ranged = all.some((r) => parseRange(r.range) !== null);
  // Tie-safe: two open bottoms (`≤N`) both start at -Infinity, and a subtraction of those is NaN.
  const lo = (r: TableRow) => parseRange(r.range)?.lo ?? 0;
  const rows = ranged ? [...all].sort((a, b) => (lo(a) < lo(b) ? -1 : lo(a) > lo(b) ? 1 : 0)) : all;
  return rows.map((r, k) => {
    // An open top (`6+`) can only be the last row, which takes the rest anyway.
    if (k === rows.length - 1 || parseRange(r.range)?.hi === Infinity) return { row: r };
    return ranged ? { row: r, le: parseRange(r.range)?.hi ?? 0 } : { row: r, eq: all.indexOf(r) + 1 };
  });
}

/** The row the generated lookups give for a total (see `lookupOrder`); null for a table without rows. */
export function lookupRow(table: TableDef, total: number): TableRow | null {
  for (const b of lookupOrder(table)) if (b.eq !== undefined ? total === b.eq : b.le !== undefined ? total <= b.le : true) return b.row;
  return null;
}

/** Problems in one table: no rows, a bad formula, ranges that leave a gap or overlap, a row without text. */
export function tableProblems(table: TableDef): ConfigProblem[] {
  const out: ConfigProblem[] = [];
  const bad = (code: ConfigProblem["code"], ...args: (string | number)[]) => out.push({ code, args: args.map(String) });
  // A table read from a note is checked once its rows are in (resolveTables); here only when inline.
  if (table.rows === undefined) {
    if (table.from === undefined) bad("tableRows", table.id);
    if (table.dice !== undefined && parseFormula(table.dice) === null) bad("tableDice", table.id, table.dice);
    return out;
  }
  if (table.rows.length === 0) bad("tableRows", table.id);
  const formula = tableFormula(table);
  if (formula === null) {
    bad("tableDice", table.id, table.dice ?? "");
    return out;
  }
  table.rows.forEach((r, i) => {
    if (r.text === undefined || r.text === null || (typeof r.text === "string" ? r.text === "" : Object.keys(r.text).length === 0)) bad("tableRow", table.id, i + 1);
  });
  const rs = ranges(table);
  const some = rs.some((r) => r !== null);
  if (!some) {
    // One face per row: an explicit formula must then have exactly as many totals as rows.
    const span = formulaSpan(formula);
    if (table.dice !== undefined && span.max - span.min + 1 !== table.rows.length) bad("tableRange", table.id, `${table.rows.length} rows, ${formatFormula(formula)} gives ${span.min}..${span.max}`);
    return out;
  }
  const missing = rs.map((r, i) => (r === null ? i + 1 : null)).filter((i): i is number => i !== null);
  if (missing.length > 0) bad("tableRange", table.id, `no range on row ${missing.join(", ")}`);
  const span = formulaSpan(formula);
  const covered = new Map<number, number>();
  for (const r of rs) {
    if (r === null) continue;
    // An open end covers the rest of the dice's span on that side; what a modifier adds beyond it is its own.
    const lo = Number.isFinite(r.lo) ? r.lo : span.min, hi = Number.isFinite(r.hi) ? r.hi : span.max;
    for (let n = lo; n <= hi; n++) covered.set(n, (covered.get(n) ?? 0) + 1);
  }
  const totals = formula.d66
    ? Array.from({ length: 36 }, (_, i) => (Math.floor(i / 6) + 1) * 10 + (i % 6) + 1 + formula.bonus)
    : Array.from({ length: span.max - span.min + 1 }, (_, i) => span.min + i);
  const gaps = totals.filter((n) => !covered.has(n));
  const overlaps = totals.filter((n) => (covered.get(n) ?? 0) > 1);
  // A d66 range like 11-33 spans numbers no d66 shows (17..20): inside the span they are not outside.
  const outside = [...covered.keys()].filter((n) => !totals.includes(n) && (!formula.d66 || n < span.min || n > span.max));
  const parts: string[] = [];
  if (gaps.length > 0) parts.push(`no row for ${brief(gaps)}`);
  if (overlaps.length > 0) parts.push(`two rows for ${brief(overlaps)}`);
  if (outside.length > 0) parts.push(`${brief(outside)} outside ${formatFormula(formula)} (${span.min}..${span.max})`);
  if (parts.length > 0) bad("tableRange", table.id, parts.join("; "));
  return out;
}

function brief(ns: number[]): string {
  return ns.length > 6 ? `${ns.slice(0, 5).join(", ")}, … (${ns.length})` : ns.join(", ");
}

/** The first markdown table in a note: header cells and body rows, cells trimmed. Null when there is none. */
export function parseMarkdownTable(md: string): { header: string[]; rows: string[][] } | null {
  const lines = md.split(/\r?\n/);
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].includes("|") || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const header = cells(lines[i]);
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && lines[j].includes("|"); j++) rows.push(cells(lines[j]));
    return { header, rows };
  }
  return null;
}

const RANGE_HEADERS = new Set(["range", "roll", "dice", "d", "范围", "骰", "骰子", "点数", "掷"]);
const ID_HEADERS = new Set(["id", "编号"]);
const SPAWN_HEADERS = new Set(["spawn", "生成"]);
const COUNT_HEADERS = new Set(["count", "数量"]);

/**
 * Rows from a note's markdown table. The range column is the one headed `range`/`roll`/`骰`… or by a
 * formula (`1d6`, `d66`: that becomes the table's dice), else the first column when every cell in it
 * is a range. Text comes from the columns headed by the game's language codes (`zh`, `en`), else
 * from the first other column; an `id` column gives each row an id, `spawn`/`count` columns the template a row
 * spawns and how many (RPG PRD §4.1). Null when the note has no table.
 */
export function rowsFromMarkdown(md: string, languages: string[]): { rows: TableRow[]; dice?: string } | null {
  const table = parseMarkdownTable(md);
  if (!table || table.header.length === 0) return null;
  const header = table.header.map((h) => h.toLowerCase());
  let rangeCol = header.findIndex((h) => RANGE_HEADERS.has(h) || parseFormula(h) !== null);
  if (rangeCol < 0 && table.rows.length > 0 && table.rows.every((r) => parseRange(r[0]) !== null)) rangeCol = 0;
  const idCol = header.findIndex((h) => ID_HEADERS.has(h));
  const spawnCol = header.findIndex((h) => SPAWN_HEADERS.has(h));
  const countCol = header.findIndex((h) => COUNT_HEADERS.has(h));
  const langCols = languages.map((l) => header.indexOf(l.toLowerCase())).filter((i) => i >= 0);
  const textCol = header.findIndex((_, i) => i !== rangeCol && i !== idCol && i !== spawnCol && i !== countCol);
  if (langCols.length === 0 && textCol < 0) return null;
  const rows: TableRow[] = table.rows.map((cells) => {
    const text: LocalizedText = langCols.length > 0
      ? Object.fromEntries(languages.filter((l) => header.includes(l.toLowerCase())).map((l) => [l, cells[header.indexOf(l.toLowerCase())] ?? ""]))
      : cells[textCol] ?? "";
    const row: TableRow = { text };
    if (rangeCol >= 0 && cells[rangeCol] !== undefined && cells[rangeCol] !== "") row.range = cells[rangeCol];
    if (idCol >= 0 && cells[idCol]) row.id = cells[idCol];
    if (spawnCol >= 0 && cells[spawnCol]) row.spawn = cells[spawnCol];
    const count = countCol >= 0 ? (cells[countCol] ?? "").trim() : "";
    if (count !== "") row.count = /^\d+$/.test(count) ? Number(count) : count;
    return row;
  });
  const dice = rangeCol >= 0 && parseFormula(table.header[rangeCol]) !== null ? table.header[rangeCol].trim() : undefined;
  return dice === undefined ? { rows } : { rows, dice };
}

/**
 * Fills in the rows of the tables kept in notes (`from`): paths are taken relative to `dir` (the
 * game's folder, "" or ending in "/"), or from the vault root when they start with "/". Returns the
 * config to play with, the problems found (a note missing or without a table, then the usual
 * table checks) and the note paths read, which the caller treats as dependencies.
 */
export async function resolveTables(
  config: GameConfig,
  read: (path: string) => Promise<string | null>,
  dir: string,
): Promise<{ config: GameConfig; problems: ConfigProblem[]; files: string[] }> {
  const tables = config.tables ?? [];
  if (!tables.some((t) => t.from !== undefined)) return { config, problems: [], files: [] };
  const problems: ConfigProblem[] = [];
  const files: string[] = [];
  const resolved: TableDef[] = [];
  for (const t of tables) {
    if (t.from === undefined || t.rows !== undefined) {
      resolved.push(t);
      continue;
    }
    const path = t.from.startsWith("/") ? t.from.slice(1) : dir + t.from.replace(/^\.\//, "");
    files.push(path);
    const md = await read(path);
    const got = md === null ? null : rowsFromMarkdown(md, config.languages ?? []);
    if (got === null) {
      problems.push({ code: "tableFile", args: [t.id, path] });
      resolved.push({ ...t, rows: [] });
      continue;
    }
    const table: TableDef = { ...t, rows: got.rows, ...(t.dice === undefined && got.dice !== undefined ? { dice: got.dice } : {}) };
    problems.push(...tableProblems(table));
    resolved.push(table);
  }
  return { config: { ...config, tables: resolved }, problems, files };
}
