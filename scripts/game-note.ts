// The game note (game.md) next to a main story, for the command-line tools: its frontmatter
// parsed with `yaml` (the plugin reads it through Obsidian's metadata cache instead).
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { GAME_NOTE_NAMES } from "../src/game/config";

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
    const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    try {
      return { name, frontmatter: m ? (parseYaml(m[1]) as unknown) : undefined };
    } catch (e) {
      return { name, frontmatter: undefined, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return null;
}
