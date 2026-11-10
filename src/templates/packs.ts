/**
 * New games on a first-party rule-system pack (RPG PRD §5): the packs come bundled (`virtual:packs`, id → path in the
 * pack → text); `packList` names them for the picker and `packGame` says which files to write: the pack into the
 * vault's packs folder (unless it is there already) and the pack's `template/` into the new game's folder, with the
 * game note's `system:` rewritten to point from the game to the pack. Pure: the plugin writes the files.
 */
import { localize, type LocalizedText } from "../game/config";
import { joinPath } from "../game/system";

export type PackBundle = Record<string, Record<string, string>>;

export interface PackInfo {
  id: string;
  name: string;
  description: string;
  version: string;
}

/** The bundled packs that have a template, named in `lang`. `frontmatter` reads a note's frontmatter. */
export function packList(bundle: PackBundle, lang: string, frontmatter: (text: string) => unknown): PackInfo[] {
  const out: PackInfo[] = [];
  for (const [id, files] of Object.entries(bundle)) {
    if (files["system.md"] === undefined || files["template/game.md"] === undefined) continue;
    const fm = frontmatter(files["system.md"]);
    const obj = typeof fm === "object" && fm !== null ? (fm as Record<string, unknown>) : {};
    const pack = typeof obj.pack === "object" && obj.pack !== null ? (obj.pack as { name?: LocalizedText; description?: LocalizedText }) : {};
    const v = obj.version;
    out.push({
      id,
      name: localize(pack.name, lang, id),
      description: localize(pack.description, lang, ""),
      version: typeof v === "string" || typeof v === "number" ? String(v) : "",
    });
  }
  return out;
}

/** The path that leads from folder `from` to `to` (both vault paths, no leading slash). */
export function relativePath(from: string, to: string): string {
  const a = joinPath(from).split("/").filter((s) => s !== "");
  const b = joinPath(to).split("/").filter((s) => s !== "");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const parts = [...a.slice(i).map(() => ".."), ...b.slice(i)];
  return parts.length === 0 ? "." : parts.join("/");
}

/**
 * The files for a new game on pack `id`: `pack` (paths under `packDir`) and `game` (paths under `gameDir`), each
 * path → text. The template's `system:` path (the first one in its frontmatter) is replaced by the way from the game
 * to the pack. Null when the bundle has no such pack or template.
 */
export function packGame(bundle: PackBundle, id: string, packDir: string, gameDir: string): { pack: Record<string, string>; game: Record<string, string> } | null {
  const files = bundle[id];
  if (!files || files["template/game.md"] === undefined) return null;
  const pack: Record<string, string> = {};
  const game: Record<string, string> = {};
  for (const [p, text] of Object.entries(files)) {
    if (p.startsWith("template/")) game[`${gameDir}/${p.slice("template/".length)}`] = text;
    else pack[`${packDir}/${p}`] = text;
  }
  const rel = relativePath(gameDir, packDir);
  const note = `${gameDir}/game.md`;
  game[note] = game[note].replace(/^(system:\s*(?:\{\s*path:\s*)?)("[^"]*"|'[^']*'|[^,}\n]+?)(\s*[,}]|\s*$)/m, (_m, head: string, _old: string, tail: string) => `${head}${JSON.stringify(rel)}${tail}`);
  return { pack, game };
}
