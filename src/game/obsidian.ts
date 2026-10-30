import { TFile, type App } from "obsidian";
import { readConfig, type LoadedConfig } from "./config";

/** A game folder holds its main story and one of these notes, whose frontmatter is the GameConfig. */
export const GAME_NOTE_NAMES = ["游戏.md", "game.md"];

/** The game note next to a main story, if any. */
export function findGameNote(app: App, rootPath: string): TFile | null {
  const slash = rootPath.lastIndexOf("/");
  const dir = slash < 0 ? "" : rootPath.slice(0, slash + 1);
  for (const name of GAME_NOTE_NAMES) {
    const f = app.vault.getAbstractFileByPath(dir + name);
    if (f instanceof TFile) return f;
  }
  return null;
}

/**
 * Reads the GameConfig from the note's frontmatter (via the metadata cache, so it works on
 * mobile and needs no YAML parser). Shape and rule problems come back as data for `T()`.
 */
export function loadGameConfig(app: App, note: TFile): LoadedConfig {
  return readConfig(app.metadataCache.getFileCache(note)?.frontmatter);
}
