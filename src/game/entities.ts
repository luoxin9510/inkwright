/**
 * Dynamic entities (RPG PRD §4.1): the monsters, summons and NPCs that come and go during play. Each kind keeps
 * its entities in one ink string variable, `id|template|stat=value,stat=value` per entity, `;` between them.
 * Ids are identifiers (a template id and a serial number) and stats are numbers, so nothing needs escaping.
 * Pure, so the engine binds these as lookahead-safe EXTERNALs: a replay, a back or a load gets the same store.
 */

export interface Entity {
  id: string;
  template: string;
  stats: Record<string, number>;
}

/** The entities in a store, in the order they came. */
export function entities(store: string): Entity[] {
  if (store === "") return [];
  return store.split(";").filter((e) => e !== "").map((e) => {
    const [id = "", template = "", body = ""] = e.split("|");
    const stats: Record<string, number> = {};
    for (const pair of body.split(",")) {
      const at = pair.indexOf("=");
      if (at <= 0) continue;
      const v = Number(pair.slice(at + 1));
      stats[pair.slice(0, at)] = Number.isFinite(v) ? v : 0;
    }
    return { id, template, stats };
  });
}

/** A store holding these entities. */
export function entityStore(list: readonly Entity[]): string {
  return list.map((e) => `${e.id}|${e.template}|${Object.entries(e.stats).map(([k, v]) => `${k}=${v}`).join(",")}`).join(";");
}

/** The store with a new entity at the end; unchanged when the id is already there or is empty. */
export function entSpawn(store: string, id: string, template: string, stats: Record<string, number>): string {
  const list = entities(store);
  if (id === "" || list.some((e) => e.id === id)) return store;
  return entityStore([...list, { id, template, stats: { ...stats } }]);
}

export function entHas(store: string, id: string): boolean {
  return entities(store).some((e) => e.id === id);
}

/** A stat of an entity; 0 when the entity or the stat is not there. */
export function entGet(store: string, id: string, stat: string): number {
  return entities(store).find((e) => e.id === id)?.stats[stat] ?? 0;
}

/**
 * The store with a stat set. Setting the kind's `remove` stat to 0 or less takes the entity out (a monster
 * killed); `remove` "" never does.
 */
export function entSet(store: string, id: string, stat: string, value: number, remove = ""): string {
  const list = entities(store);
  const e = list.find((x) => x.id === id);
  if (!e || stat === "") return store;
  if (remove !== "" && stat === remove && value <= 0) return entityStore(list.filter((x) => x !== e));
  e.stats[stat] = Number.isFinite(value) ? value : 0;
  return entityStore(list);
}

/** The store without this entity. */
export function entDrop(store: string, id: string): string {
  const list = entities(store);
  const kept = list.filter((e) => e.id !== id);
  return kept.length === list.length ? store : entityStore(kept);
}

export function entCount(store: string): number {
  return entities(store).length;
}

/** The id of the k-th entity (1-based); "" past the end. */
export function entAt(store: string, k: number): string {
  return entities(store)[Math.floor(k) - 1]?.id ?? "";
}

/**
 * One entity chosen without dice: "first", "last", "lowest:<stat>", "highest:<stat>" (the earliest on a tie).
 * "" when there is none or the way is not one of these (random picks roll in the generated ink).
 */
export function entPick(store: string, how: string): string {
  const list = entities(store);
  if (list.length === 0) return "";
  if (how === "first") return list[0].id;
  if (how === "last") return list[list.length - 1].id;
  const m = /^(lowest|highest):(.+)$/.exec(how);
  if (!m) return "";
  const stat = m[2], low = m[1] === "lowest";
  let best = list[0];
  for (const e of list) {
    const a = e.stats[stat] ?? 0, b = best.stats[stat] ?? 0;
    if (low ? a < b : a > b) best = e;
  }
  return best.id;
}

/**
 * How the panel names an entity: its template's name, numbered when the store holds others of the same
 * template ("Goblin 2"), by their order there.
 */
export function entLabel(store: string, id: string, templateName: (template: string) => string): string {
  const list = entities(store);
  const e = list.find((x) => x.id === id);
  if (!e) return "";
  const same = list.filter((x) => x.template === e.template);
  const name = templateName(e.template);
  return same.length > 1 ? `${name} ${same.indexOf(e) + 1}` : name;
}
