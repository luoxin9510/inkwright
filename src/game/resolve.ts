// Everything a game note points at outside itself: tables kept in other notes, decks kept as
// folders of notes, a map drawn in a canvas. The plugin and check-ink each provide a source.
import { resolveDecks, type NoteLister } from "./cards";
import { resolveMap } from "./canvas";
import { validateConfig, type ConfigProblem, type GameConfig } from "./config";
import { shapeProblem, shapesFromMarkdown } from "./dungeon";
import { characterFromNote } from "./sheet";
import { joinPath } from "./system";
import { resolveTables } from "./tables";

export interface ConfigSource {
  /** A text file by path (relative to the game's folder or absolute in the vault); null when it does not exist. */
  read(path: string): Promise<string | null>;
  /** The notes directly inside a folder; null when there is no such folder. */
  notes: NoteLister;
}

/** Fills a dungeon's shapes in from its `from` note (joined to the ones written in the game note); paths as for tables. */
export async function resolveDungeon(
  config: GameConfig,
  read: (path: string) => Promise<string | null>,
  dir: string,
): Promise<{ config: GameConfig; problems: ConfigProblem[]; files: string[] }> {
  const d = config.dungeon;
  if (!d || d.from === undefined) return { config, problems: [], files: [] };
  const clean = d.from.replace(/^\.\//, "");
  const path = dir === "" || clean.startsWith("/") ? clean.replace(/^\/+/, "") : `${dir}${clean}`;
  const text = await read(path);
  const found = text === null ? [] : shapesFromMarkdown(text);
  if (found.length === 0) return { config, problems: [{ code: "dungeonFile", args: [d.from] }], files: [path] };
  const problems: ConfigProblem[] = [];
  const have = new Set(d.shapes.map((s) => s.id));
  const added = found.filter((s) => {
    if (have.has(s.id)) {
      problems.push({ code: "duplicate", args: [s.id] });
      return false;
    }
    have.add(s.id);
    const why = shapeProblem(s);
    if (why) problems.push({ code: "dungeonShape", args: [s.id, why] });
    return true;
  });
  return { config: { ...config, dungeon: { ...d, shapes: [...d.shapes, ...added] } }, problems, files: [path] };
}

/**
 * Fills the characters in from `characters: { from: folder }` (RPG PRD §4.6): every note there is a character sheet,
 * in name order; a note of the wrong shape is a `shape` problem. The folder and its notes are dependencies.
 */
export async function resolveCharacters(
  config: GameConfig,
  notes: ConfigSource["notes"],
  dir: string,
): Promise<{ config: GameConfig; problems: ConfigProblem[]; files: string[] }> {
  if (config.charactersFrom === undefined) return { config, problems: [], files: [] };
  const from = config.charactersFrom;
  const folder = joinPath(from.startsWith("/") ? from : `${dir}${from}`).replace(/^\/+/, "");
  const list = await notes(folder);
  if (!list || list.length === 0) return { config, problems: [{ code: "charactersFolder", args: [from] }], files: [folder] };
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const problems: ConfigProblem[] = [];
  const characters = sorted.flatMap((note) => {
    const c = characterFromNote(note);
    if (!c) problems.push({ code: "shape", args: [note.path] });
    return c ? [c] : [];
  });
  const next: GameConfig = { ...config, characters: [...config.characters, ...characters], charactersFrom: undefined };
  // Only what the sheets brought in is new; the note's own problems were reported already.
  const before = new Set(validateConfig(config).map((p) => JSON.stringify(p)));
  for (const p of validateConfig(next)) if (!before.has(JSON.stringify(p))) problems.push(p);
  return { config: next, problems, files: [folder, ...sorted.map((n) => n.path)] };
}

/** The config with its outside parts filled in, the problems met, and every file read (compile dependencies). */
export async function resolveConfig(
  config: GameConfig,
  source: ConfigSource,
  dir: string,
): Promise<{ config: GameConfig; problems: ConfigProblem[]; files: string[] }> {
  const ch = await resolveCharacters(config, (f) => source.notes(f), dir);
  const t = await resolveTables(ch.config, (p) => source.read(p), dir);
  // Rows read from notes may spawn (a `spawn` column): checked like rows written in the note, only new problems.
  if (t.files.length > 0) {
    const before = new Set(validateConfig(ch.config).map((p) => JSON.stringify(p)));
    for (const p of validateConfig(t.config)) if (!before.has(JSON.stringify(p))) t.problems.push(p);
  }
  const d = await resolveDecks(t.config, (f) => source.notes(f), dir);
  const m = await resolveMap(d.config, (p) => source.read(p), dir);
  const g = await resolveDungeon(m.config, (p) => source.read(p), dir);
  return { config: g.config, problems: [...ch.problems, ...t.problems, ...d.problems, ...m.problems, ...g.problems], files: [...ch.files, ...t.files, ...d.files, ...m.files, ...g.files] };
}
