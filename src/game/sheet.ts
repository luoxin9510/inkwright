// Character sheets (RPG PRD §4.6): at the end of an adventure the character is written as a note whose frontmatter
// is a `characters` entry (skills, items, counts, level, resources, statuses), so the next adventure reads it with
// `characters: { from: folder }` through the same readConfig. Pure: the plugin turns the frontmatter into YAML and
// writes the note.
import { carries, inkNames, isCharacter, localize, type CharacterDef, type GameConfig, type StateReader } from "./config";
import type { CardNote } from "./cards";
import { statusEntries } from "./statuses";

/** The character being played (`current`, its id), as a `characters` entry read from the story's state. Null when none is picked. */
export function sheetOf(config: GameConfig, state: StateReader, current: string | null): CharacterDef | null {
  const n = inkNames(config);
  const c = config.characters.find((x) => x.id === current);
  if (!c) return null;
  const num = (name: string) => Number(state(name) ?? 0);
  const out: CharacterDef = { id: c.id, ...(c.name !== undefined ? { name: c.name } : {}), skills: Object.fromEntries(config.skills.map((sk) => [sk.id, num(sk.id)])) };
  const items = config.items ?? [];
  if (items.length > 0) {
    const inventory = state(n.inventory);
    const carried = items.filter((i) => carries(inventory, i.id));
    const plain = carried.filter((i) => !i.stack).map((i) => i.id);
    const counts: Record<string, number> = {};
    for (const i of items.filter((x) => x.stack)) {
      const k = num(`${i.id}${n.stackSuffix}`);
      if (k > 0) counts[i.id] = k;
    }
    if (plain.length > 0) out.items = plain;
    if (config.slots?.length) {
      const equipped = state(n.equipped);
      const worn = carried.filter((i) => i.slot !== undefined && carries(equipped, i.id)).map((i) => i.id);
      if (worn.length > 0) out.equipped = worn;
    }
    if (Object.keys(counts).length > 0) out.counts = counts;
  }
  if (config.levels) out.level = Math.max(1, num(n.level));
  if (config.resources.length > 0) out.resources = Object.fromEntries(config.resources.map((r) => [r.id, num(r.id)]));
  if (config.statuses?.length) {
    const store = state(n.statusVar);
    const mine = statusEntries(typeof store === "string" ? store : "").filter((e) => e.who === n.self);
    if (mine.length > 0) out.statuses = Object.fromEntries(mine.map((e) => [e.id, e.turns]));
  }
  if (c.playable === false) out.playable = false;
  return out;
}

/** The sheet's file name (without .md): the character's name in `lang`, with characters a file system refuses replaced. */
export function sheetName(c: CharacterDef, lang: string): string {
  return localize(c.name, lang, c.id).replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || c.id;
}

/** A character read from a sheet note: its frontmatter as a `characters` entry, the id the file's name when it has none. Null when the shape is wrong. */
export function characterFromNote(note: CardNote): CharacterDef | null {
  const fm = note.frontmatter ?? {};
  const id = typeof fm.id === "string" && fm.id !== "" ? fm.id : note.name;
  if (!isCharacter(fm)) return null;
  const c = { ...(fm as unknown as CharacterDef), id };
  return { ...c, skills: c.skills ?? {} };
}

/**
 * The sheet note's text: the frontmatter (`yaml` = the sheet as YAML) replaced whole, the body kept and this
 * adventure's epilogue added under a heading (title and date), so the note grows into the campaign's record.
 */
export function sheetNote(yaml: string, oldBody: string, epilogue: string, title: string, date: string): string {
  const kept = oldBody.trim();
  const section = [`## ${title} · ${date}`, ...(epilogue.trim() !== "" ? ["", epilogue.trim()] : [])].join("\n");
  return `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n\n${kept !== "" ? `${kept}\n\n` : ""}${section}\n`;
}
