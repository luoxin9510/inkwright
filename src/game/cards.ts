// Decks kept as notes: a folder with one note per card. The file name is the card's id, the
// frontmatter gives name, desc, image and the card's numbers (attrs), the body is the description
// when the frontmatter has none. The plugin lists the folder through the vault, check-ink from disk.
import { isIdent, readCard, validateConfig, type CardDef, type ConfigProblem, type DeckDef, type GameConfig } from "./config";

/** One note in a deck's folder, as the source hands it over. */
export interface CardNote {
  /** Vault (or disk) path of the note. */
  path: string;
  /** File name without the extension. */
  name: string;
  frontmatter: Record<string, unknown> | undefined;
  /** The note's text after the frontmatter. */
  body: string;
}

/** The notes directly inside a folder (not sorted); null when there is no such folder. */
export type NoteLister = (folder: string) => Promise<CardNote[] | null>;

/** A card from its note: id from the frontmatter or the file name, desc from the body when not given. */
export function cardFromNote(note: CardNote): CardDef {
  const fm = note.frontmatter ?? {};
  const id = typeof fm.id === "string" && fm.id !== "" ? fm.id : note.name;
  const card = readCard(fm, id);
  if (card.name === undefined) card.name = note.name;
  const body = note.body.trim();
  if (card.desc === undefined && body !== "") card.desc = body;
  return card;
}

/** Joins a game folder and a path written in the note, keeping absolute vault paths as they are. */
function join(dir: string, path: string): string {
  const clean = path.replace(/^\.\//, "").replace(/\/+$/, "");
  return dir === "" || clean.startsWith("/") ? clean.replace(/^\/+/, "") : `${dir}${clean}`;
}

/**
 * Fills in the decks that come `from:` a folder. Problems name the deck and folder; a folder read
 * is listed in `files` (the notes) so the story recompiles when one changes. The config's own
 * validation runs again on the result, so bad card ids and duplicates are reported as usual.
 */
export async function resolveDecks(
  config: GameConfig,
  notes: NoteLister,
  dir: string,
): Promise<{ config: GameConfig; problems: ConfigProblem[]; files: string[] }> {
  const decks = config.decks ?? [];
  if (!decks.some((d) => d.from !== undefined)) return { config, problems: [], files: [] };
  const problems: ConfigProblem[] = [];
  const files: string[] = [];
  const resolved: DeckDef[] = [];
  for (const d of decks) {
    if (d.from === undefined) {
      resolved.push(d);
      continue;
    }
    const folder = join(dir, d.from);
    const list = await notes(folder);
    if (!list || list.length === 0) {
      problems.push({ code: "deckFolder", args: [d.id, d.from] });
      resolved.push(d);
      continue;
    }
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "zh"));
    files.push(...sorted.map((n) => n.path));
    resolved.push({ ...d, from: undefined, cards: [...d.cards, ...sorted.map(cardFromNote)] });
  }
  const next = { ...config, decks: resolved };
  // Only what the resolution brought in is new; the note's own problems were reported already.
  const before = new Set(validateConfig(config).map((p) => JSON.stringify(p)));
  for (const p of validateConfig(next)) if (!before.has(JSON.stringify(p))) problems.push(p);
  return { config: next, problems, files };
}

/** Whether a file name can be a card id as it stands (else the note needs an `id` in its frontmatter). */
export const isCardName = isIdent;
