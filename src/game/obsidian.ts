import { TFile, TFolder, arrayBufferToBase64, normalizePath, parseYaml, type App } from "obsidian";
import { GAME_NOTE_NAMES, readConfig, type GameConfig, type LoadedConfig } from "./config";
import type { CardNote } from "./cards";
import { splitNote } from "./frontmatter";
import type { ConfigSource } from "./resolve";
import { withSystem } from "./system";
import { folderOf } from "../paths";

/** The game note next to a main story, if any. */
export function findGameNote(app: App, rootPath: string): TFile | null {
  const dir = folderOf(rootPath);
  for (const name of GAME_NOTE_NAMES) {
    const f = app.vault.getAbstractFileByPath(dir + name);
    if (f instanceof TFile) return f;
  }
  return null;
}

/**
 * The config with the rule-system pack the note names (`system:`) layered under it: the pack's `system.md` is read
 * from the file (parsed with Obsidian's YAML), its `rules.ink` noted for the engine's INCLUDE. `files` are the notes
 * read, so editing the pack recompiles the game.
 */
export async function loadGameNote(app: App, note: TFile, read: (path: string) => Promise<string>): Promise<LoadedConfig & { files: string[] }> {
  const sys = await withSystem(app.metadataCache.getFileCache(note)?.frontmatter, folderOf(note.path), (p) => read(p).catch(() => null), parseYaml, splitNote);
  const r = readConfig(sys.frontmatter);
  if (r.config && sys.rules) r.config.systemRules = sys.rules;
  return { config: r.config, problems: [...sys.problems, ...r.problems], files: sys.files };
}

/**
 * What a game note may point at, in the vault: notes by path (read with `read`), and folders of card notes.
 * A card note is read from the file, frontmatter included (the metadata cache can lag behind a modify event).
 */
export function vaultConfigSource(app: App, read: (path: string) => Promise<string>): ConfigSource {
  return {
    read: (p) => read(p).catch(() => null),
    notes: async (folder) => {
      const f = app.vault.getAbstractFileByPath(normalizePath(folder));
      if (!(f instanceof TFolder)) return null;
      const out: CardNote[] = [];
      for (const child of f.children) {
        if (!(child instanceof TFile) || child.extension !== "md") continue;
        const note = splitNote(await app.vault.read(child), parseYaml);
        out.push({ path: child.path, name: child.basename, frontmatter: note.frontmatter, body: note.body });
      }
      return out;
    },
  };
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/**
 * The pictures a game note names (the map's image, card art), looked up next to the story first, then as vault
 * paths: as resource URLs for the panel, data URIs for an exported page, or their paths (they are dependencies).
 */
export class GameFiles {
  constructor(private readonly app: App, private readonly storyPath: string) {}

  /** The file a path names; null when there is none. */
  file(path: string | undefined): TFile | null {
    if (!path) return null;
    for (const p of [normalizePath(folderOf(this.storyPath) + path), normalizePath(path)]) {
      const file = this.app.vault.getAbstractFileByPath(p);
      if (file instanceof TFile) return file;
    }
    return null;
  }

  /** A picture as a resource URL for the panel; null when there is none. */
  url(path: string | undefined): string | null {
    const file = this.file(path);
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  /** A picture as a data URI for an exported page; undefined when there is none. */
  async dataUri(path: string | undefined): Promise<string | undefined> {
    const file = this.file(path);
    if (!file) return undefined;
    const data = await this.app.vault.readBinary(file);
    return `data:${MIME[file.extension.toLowerCase()] ?? "application/octet-stream"};base64,${arrayBufferToBase64(data)}`;
  }

  /** Every card's art by card id, as resource URLs. */
  cardArt(config: GameConfig): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of (config.decks ?? []).flatMap((d) => d.cards)) {
      const url = this.url(c.image);
      if (url) out[c.id] = url;
    }
    return out;
  }

  /** Every card's art by card id, as data URIs. */
  async cardArtInline(config: GameConfig): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const c of (config.decks ?? []).flatMap((d) => d.cards)) {
      const uri = await this.dataUri(c.image);
      if (uri) out[c.id] = uri;
    }
    return out;
  }

  /** The vault paths of the pictures the config names that exist. */
  paths(config: GameConfig): string[] {
    return [config.map?.image, ...(config.decks ?? []).flatMap((d) => d.cards.map((c) => c.image))]
      .map((p) => this.file(p)?.path)
      .filter((p): p is string => p !== undefined);
  }
}
