// Everything a game note points at outside itself: tables kept in other notes, decks kept as
// folders of notes, a map drawn in a canvas. The plugin and check-ink each provide a source.
import { resolveDecks, type NoteLister } from "./cards";
import { resolveMap } from "./canvas";
import type { ConfigProblem, GameConfig } from "./config";
import { resolveTables } from "./tables";

export interface ConfigSource {
  /** A text file by path (relative to the game's folder or absolute in the vault); null when it does not exist. */
  read(path: string): Promise<string | null>;
  /** The notes directly inside a folder; null when there is no such folder. */
  notes: NoteLister;
}

/** The config with its outside parts filled in, the problems met, and every file read (compile dependencies). */
export async function resolveConfig(
  config: GameConfig,
  source: ConfigSource,
  dir: string,
): Promise<{ config: GameConfig; problems: ConfigProblem[]; files: string[] }> {
  const t = await resolveTables(config, (p) => source.read(p), dir);
  const d = await resolveDecks(t.config, (f) => source.notes(f), dir);
  const m = await resolveMap(d.config, (p) => source.read(p), dir);
  return { config: m.config, problems: [...t.problems, ...d.problems, ...m.problems], files: [...t.files, ...d.files, ...m.files] };
}
