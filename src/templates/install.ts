/**
 * Installing a rule-system pack from the web (RPG PRD §5, question 5): the public games repo keeps each pack in
 * `systems/<id>/` and lists them in `systems/index.json`; a pack's `system.md` names its files (`files:`, paths in the
 * pack). The plugin fetches the index, then `system.md`, then every file it names, and writes them into the vault's
 * packs folder. Pure: `fetchText` is injected (Obsidian's requestUrl in the plugin, a map in tests).
 */
import { localize, type LocalizedText } from "../game/config";

export const PACK_SOURCE = "https://raw.githubusercontent.com/luoxin9510/ink-games/main/systems/";

export interface IndexEntry {
  id: string;
  version: string;
  name: LocalizedText | undefined;
  description: LocalizedText | undefined;
}

/** A pack id: lower-case letters, digits and dashes (it becomes a folder name and a URL segment). */
export function isPackId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

/** The packs `systems/index.json` lists (`{ packs: [{ id, version, name, description }] }`); bad entries are left out. */
export function parseIndex(text: string): IndexEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const packs = typeof data === "object" && data !== null ? (data as { packs?: unknown }).packs : undefined;
  if (!Array.isArray(packs)) return [];
  const out: IndexEntry[] = [];
  for (const p of packs) {
    if (typeof p !== "object" || p === null) continue;
    const e = p as Record<string, unknown>;
    if (!isPackId(e.id) || out.some((o) => o.id === e.id)) continue;
    out.push({
      id: e.id,
      version: typeof e.version === "string" || typeof e.version === "number" ? String(e.version) : "",
      name: e.name as LocalizedText | undefined,
      description: e.description as LocalizedText | undefined,
    });
  }
  return out;
}

/** An entry's name and description in `lang`. */
export function indexText(e: IndexEntry, lang: string): { name: string; description: string } {
  return { name: localize(e.name, lang, e.id), description: localize(e.description, lang, "") };
}

/**
 * A path inside a pack that is safe to fetch and write: relative, `/`-separated, no `.`/`..`/empty parts, no
 * characters a file system or a URL would trip on, no hidden files.
 */
export function isPackPath(p: unknown): p is string {
  if (typeof p !== "string" || p === "" || p.length > 200) return false;
  const plain = (part: string) => [...part].every((c) => c.charCodeAt(0) >= 0x20 && !'\\:*?"<>|#%'.includes(c));
  return p.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith(".") && plain(part));
}

/**
 * The files a pack's `system.md` frontmatter names (`files:`), `system.md` first and once. Null when the list is
 * missing, empty or names a path that is not safe.
 */
export function packFiles(frontmatter: unknown): string[] | null {
  const files = typeof frontmatter === "object" && frontmatter !== null ? (frontmatter as { files?: unknown }).files : undefined;
  if (!Array.isArray(files) || files.length === 0 || !files.every(isPackPath)) return null;
  return ["system.md", ...new Set(files.filter((f) => f !== "system.md"))];
}

/** The URL of a file in pack `id` under `source` (a folder URL; each path segment encoded). */
export function packUrl(source: string, id: string, path: string): string {
  const base = source.endsWith("/") ? source : `${source}/`;
  return `${base}${encodeURIComponent(id)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export type FetchText = (url: string) => Promise<string>;

export type Download = { ok: true; files: Record<string, string>; version: string } | { ok: false; error: "id" | "fetch" | "files"; detail: string };

/**
 * Fetches pack `id`: its `system.md`, then every file that names. `files` maps paths in the pack to text. Nothing is
 * written here; a failed fetch or a bad file list fails the whole download.
 */
export async function downloadPack(fetchText: FetchText, source: string, id: string, frontmatter: (text: string) => unknown): Promise<Download> {
  if (!isPackId(id)) return { ok: false, error: "id", detail: id };
  const get = async (path: string): Promise<string | Error> => {
    try {
      return await fetchText(packUrl(source, id, path));
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  };
  const system = await get("system.md");
  if (system instanceof Error) return { ok: false, error: "fetch", detail: `system.md: ${system.message}` };
  const fm = frontmatter(system);
  const list = packFiles(fm);
  if (!list) return { ok: false, error: "files", detail: "system.md" };
  const files: Record<string, string> = { "system.md": system };
  for (const path of list.slice(1)) {
    const text = await get(path);
    if (text instanceof Error) return { ok: false, error: "fetch", detail: `${path}: ${text.message}` };
    files[path] = text;
  }
  const v = typeof fm === "object" && fm !== null ? (fm as { version?: unknown }).version : undefined;
  return { ok: true, files, version: typeof v === "string" || typeof v === "number" ? String(v) : "" };
}
