// Rule-system packs (RPG PRD §5): a folder with `system.md` (a config fragment and a version) and, optionally,
// `rules.ink` (the procedures, written on the engine's primitives). A game note names one with `system:`; the
// pack's config goes under the game's (same id: the game's wins) and the generated engine INCLUDEs its rules.
import type { ConfigProblem } from "./config";

/** Where a game's pack is (relative to the game's folder) and the version it was written for. */
export interface SystemRef {
  path: string;
  version?: string;
}

/** The pack a game note names: `system: path` or `system: { path, version }`; null when none (or not that shape). */
export function systemRef(fm: unknown): SystemRef | null {
  if (!isObj(fm)) return null;
  const s = fm.system;
  if (typeof s === "string" && s.trim() !== "") return { path: trimSlashes(s) };
  if (isObj(s) && typeof s.path === "string" && s.path.trim() !== "") {
    const v = s.version;
    return { path: trimSlashes(s.path), ...(typeof v === "string" || typeof v === "number" ? { version: String(v) } : {}) };
  }
  return null;
}

/**
 * The pack's frontmatter under the game's. Lists whose entries all have an `id` (skills, resources, items, tables,
 * kinds…) are joined by id: the pack's first, a game entry with the same id takes its place, new ones follow. Any
 * other value the game sets (rules, party, a map, languages…) replaces the pack's whole. The pack's own `version`
 * and `pack` (its name and description, for the new-game picker) stay out; the game's `system` stays in. `rel` is the pack's folder seen from the game's: the pack's `from:`
 * notes and pictures are written relative to the pack and are moved to be relative to the game.
 */
export function layerSystem(pack: Record<string, unknown>, game: Record<string, unknown>, rel: string): Record<string, unknown> {
  const moved = movePaths(pack, rel);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(moved)) if (k !== "version" && k !== "system" && k !== "pack") out[k] = v;
  for (const [k, v] of Object.entries(game)) {
    const mine = out[k];
    out[k] = keyed(mine) && keyed(v) ? joinById(mine, v) : v;
  }
  return out;
}

/** What `withSystem` gives: the frontmatter to read, problems, files read (dependencies), the rules to INCLUDE. */
export interface WithSystem {
  frontmatter: unknown;
  problems: ConfigProblem[];
  files: string[];
  /** `rules.ink` as the game's engine INCLUDEs it (relative to the game's folder); absent when the pack has none. */
  rules?: string;
}

/**
 * The game note's frontmatter with its pack layered under it. `dir` is the game's folder as `read` takes paths
 * ("" or ending in "/"); `parse` turns YAML into data (Obsidian's or the `yaml` package). A pack that cannot be read
 * is a problem (`systemMissing`) and the game's own frontmatter is used; a major version other than the one the game
 * asks for is a problem (`systemVersion`) but the pack is still used.
 */
export async function withSystem(
  frontmatter: unknown,
  dir: string,
  read: (path: string) => Promise<string | null>,
  parse: (yaml: string) => unknown,
  split: (text: string, parse: (yaml: string) => unknown) => { frontmatter: unknown },
): Promise<WithSystem> {
  const ref = systemRef(frontmatter);
  if (!ref || !isObj(frontmatter)) return { frontmatter, problems: [], files: [] };
  const folder = joinPath(`${dir}${ref.path}`);
  const notePath = `${folder}/system.md`;
  const text = await read(notePath);
  const pack = text === null ? null : split(text, parse).frontmatter;
  if (!isObj(pack)) return { frontmatter, problems: [{ code: "systemMissing", args: [ref.path] }], files: [notePath] };
  const problems: ConfigProblem[] = [];
  const have = typeof pack.version === "string" || typeof pack.version === "number" ? String(pack.version) : "";
  if (ref.version !== undefined && major(ref.version) !== major(have)) problems.push({ code: "systemVersion", args: [ref.path, ref.version, have || "?"] });
  const rulesPath = `${folder}/rules.ink`;
  const rules = (await read(rulesPath)) !== null ? `${ref.path}/rules.ink` : undefined;
  return { frontmatter: layerSystem(pack, frontmatter, ref.path), problems, files: [notePath], ...(rules ? { rules } : {}) };
}

/** A path with `.` and `x/..` folded away; unlike the vault's normalizer it keeps a leading `/` and leading `..`. */
export function joinPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(seg);
  }
  return (p.startsWith("/") ? "/" : "") + out.join("/");
}

function major(v: string): string {
  return v.trim().split(".")[0];
}

function trimSlashes(p: string): string {
  return p.trim().replace(/\/+$/, "");
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A list whose entries are all objects with an id. */
function keyed(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every((e) => isObj(e) && (typeof e.id === "string" || typeof e.id === "number"));
}

function joinById(pack: Record<string, unknown>[], game: Record<string, unknown>[]): Record<string, unknown>[] {
  const out = [...pack];
  for (const g of game) {
    const i = out.findIndex((p) => String(p.id) === String(g.id));
    if (i >= 0) out[i] = g;
    else out.push(g);
  }
  return out;
}

/** The pack's paths (tables' and decks' `from`, card pictures, the map's `from`/`image`, the dungeon's `from`) made relative to the game. */
function movePaths(pack: Record<string, unknown>, rel: string): Record<string, unknown> {
  const move = (p: unknown) => (typeof p === "string" && p !== "" && !p.startsWith("/") ? joinPath(`${rel}/${p.replace(/^\.\//, "")}`) : p);
  const withFrom = (e: unknown) => (isObj(e) && e.from !== undefined ? { ...e, from: move(e.from) } : e);
  const out: Record<string, unknown> = { ...pack };
  if (Array.isArray(pack.tables)) out.tables = pack.tables.map(withFrom);
  if (Array.isArray(pack.decks)) {
    out.decks = (pack.decks as unknown[]).map((d): unknown => {
      const moved = withFrom(d);
      if (!isObj(moved) || !Array.isArray(moved.cards)) return moved;
      return { ...moved, cards: (moved.cards as unknown[]).map((c): unknown => (isObj(c) && c.image !== undefined ? { ...c, image: move(c.image) } : c)) };
    });
  }
  if (isObj(pack.map)) out.map = { ...pack.map, ...(pack.map.from !== undefined ? { from: move(pack.map.from) } : {}), ...(pack.map.image !== undefined ? { image: move(pack.map.image) } : {}) };
  if (isObj(pack.dungeon) && pack.dungeon.from !== undefined) out.dungeon = { ...pack.dungeon, from: move(pack.dungeon.from) };
  return out;
}
