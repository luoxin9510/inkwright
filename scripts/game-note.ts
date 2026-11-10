// The game note (game.md) next to a main story, for the command-line tools: its frontmatter
// parsed with `yaml` (the plugin reads it through Obsidian's metadata cache instead).
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { GAME_NOTE_NAMES, readConfig, type ConfigProblem, type GameConfig } from "../src/game/config";
import { resolveConfig, type ConfigSource } from "../src/game/resolve";
import { splitNote } from "../src/game/frontmatter";

export interface GameNote {
  name: string;
  frontmatter: unknown;
  /** Set when the frontmatter is not valid YAML. */
  error?: string;
}

/** The game note next to a main story, or null when there is none. */
export async function gameNote(storyFile: string): Promise<GameNote | null> {
  for (const name of GAME_NOTE_NAMES) {
    let text: string;
    try {
      text = await readFile(join(dirname(storyFile), name), "utf8");
    } catch {
      continue;
    }
    const note = splitNote(text, parseYaml);
    return { name, frontmatter: note.raw, ...(note.error !== undefined ? { error: note.error } : {}) };
  }
  return null;
}

/** Tables kept in other notes, decks kept as folders, a map drawn in a canvas: read from disk, paths relative to `dir`. */
export function diskSource(dir: string): ConfigSource {
  return {
    read: (p) => readFile(join(dir, p), "utf8").catch(() => null),
    notes: async (folder) => {
      const abs = join(dir, folder);
      let names: string[];
      try {
        names = await readdir(abs);
      } catch {
        return null;
      }
      const out = [];
      for (const name of names.filter((n) => n.endsWith(".md"))) {
        const text = await readFile(join(abs, name), "utf8");
        const note = splitNote(text, parseYaml);
        out.push({ path: join(abs, name), name: name.slice(0, -3), frontmatter: note.frontmatter, body: note.body });
      }
      return out;
    },
  };
}

/** The game config next to a main story, with its `from:` notes resolved; null when there is no game note. */
export async function loadGameConfig(storyFile: string): Promise<{ note: GameNote; config: GameConfig | null; problems: ConfigProblem[] } | null> {
  const note = await gameNote(storyFile);
  if (!note) return null;
  if (note.error) return { note, config: null, problems: [] };
  const read = readConfig(note.frontmatter);
  if (!read.config) return { note, config: null, problems: read.problems };
  const r = await resolveConfig(read.config, diskSource(dirname(storyFile)), "");
  return { note, config: r.config, problems: [...read.problems, ...r.problems] };
}
