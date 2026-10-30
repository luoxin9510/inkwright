import { TFile, type App } from "obsidian";
import { validateConfig, type GameConfig } from "./config";

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

export interface LoadedGame {
  config: GameConfig | null;
  /** Why the config is unusable (config null) or questionable (config set, problems listed). */
  problems: string[];
}

const isList = (v: unknown): v is unknown[] => Array.isArray(v);

/**
 * Reads the GameConfig from the note's frontmatter (via the metadata cache, so it works on
 * mobile and needs no YAML parser). Shape errors come back as problems.
 */
export function loadGameConfig(app: App, note: TFile): LoadedGame {
  const fm: Record<string, unknown> | undefined = app.metadataCache.getFileCache(note)?.frontmatter;
  if (!fm) return { config: null, problems: ["no frontmatter"] };
  const problems: string[] = [];
  const rules = fm.rules as GameConfig["rules"] | undefined;
  if (!rules || (rules.kind !== "sum" && rules.kind !== "rollUnder")) problems.push('rules.kind must be "sum" or "rollUnder"');
  for (const key of ["skills", "characters"]) {
    const v = fm[key];
    if (!isList(v) || v.length === 0) problems.push(`${key} must be a non-empty list`);
  }
  if (problems.length > 0) return { config: null, problems };
  const config: GameConfig = {
    rules: rules as GameConfig["rules"],
    difficulties: (fm.difficulties as GameConfig["difficulties"]) ?? undefined,
    skills: fm.skills as GameConfig["skills"],
    resources: (isList(fm.resources) ? fm.resources : []) as GameConfig["resources"],
    companionResources: (isList(fm.companionResources) ? fm.companionResources : []) as GameConfig["companionResources"],
    characters: fm.characters as GameConfig["characters"],
    modifiers: (isList(fm.modifiers) ? fm.modifiers : []) as GameConfig["modifiers"],
    ink: (fm.ink as GameConfig["ink"]) ?? undefined,
  };
  for (const s of config.skills) if (typeof s !== "object" || typeof s?.id !== "string") problems.push("every skill needs an id");
  for (const c of config.characters) if (typeof c !== "object" || typeof c?.id !== "string") problems.push("every character needs an id");
  if (problems.length > 0) return { config: null, problems };
  for (const c of config.characters) c.skills ??= {};
  return { config, problems: validateConfig(config) };
}
