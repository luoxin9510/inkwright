// Status effects (RPG PRD §4.3): poisoned, stunned, blessed… on the character, a party member or an entity. The story
// keeps them in one string VAR, `who|status|turns;…` (who = an entity or member id, or the character's own name for
// itself); the engine reads and writes it through these pure functions, so lookahead and replays are safe. Turns
// above 0 count down on `tick`; 0 or less means it lasts until cleared (or until a rest, for statuses marked `rest`).

export interface StatusEntry {
  who: string;
  id: string;
  /** Turns left; 0 = until cleared. */
  turns: number;
}

export function statusEntries(store: string): StatusEntry[] {
  if (store === "") return [];
  const out: StatusEntry[] = [];
  for (const part of store.split(";")) {
    const [who, id, t] = part.split("|");
    if (who === undefined || id === undefined || who === "" || id === "") continue;
    const turns = Number(t);
    out.push({ who, id, turns: Number.isFinite(turns) && turns > 0 ? Math.floor(turns) : 0 });
  }
  return out;
}

export function formatStatuses(entries: StatusEntry[]): string {
  return entries.map((e) => `${e.who}|${e.id}|${e.turns}`).join(";");
}

/**
 * Puts a status on `who`. Already there: the longer of the two lasts (one that lasts until cleared stays so); turns
 * 0 or less = until cleared. Empty `who` or `id` changes nothing.
 */
export function statusAdd(store: string, who: string, id: string, turns: number): string {
  if (who === "" || id === "") return store;
  const t = Number.isFinite(turns) && turns > 0 ? Math.floor(turns) : 0;
  const entries = statusEntries(store);
  const at = entries.find((e) => e.who === who && e.id === id);
  if (!at) return formatStatuses([...entries, { who, id, turns: t }]);
  if (at.turns === 0 || t === 0) at.turns = 0;
  else at.turns = Math.max(at.turns, t);
  return formatStatuses(entries);
}

export function statusHas(store: string, who: string, id: string): boolean {
  return statusEntries(store).some((e) => e.who === who && e.id === id);
}

/** Turns left: 0 when absent or lasting until cleared (`statusHas` tells them apart). */
export function statusTurns(store: string, who: string, id: string): number {
  return statusEntries(store).find((e) => e.who === who && e.id === id)?.turns ?? 0;
}

/** Takes a status off `who`; `id` "" takes every status off `who`. */
export function statusClear(store: string, who: string, id: string): string {
  return formatStatuses(statusEntries(store).filter((e) => !(e.who === who && (id === "" || e.id === id))));
}

/** One turn passes: counting statuses lose a turn, those that reach 0 are gone. */
export function statusTick(store: string): string {
  const out: StatusEntry[] = [];
  for (const e of statusEntries(store)) {
    if (e.turns === 0) out.push(e);
    else if (e.turns > 1) out.push({ ...e, turns: e.turns - 1 });
  }
  return formatStatuses(out);
}

/** A rest: the statuses in `rested` (ids) are gone from everyone. */
export function statusRest(store: string, rested: ReadonlySet<string>): string {
  return formatStatuses(statusEntries(store).filter((e) => !rested.has(e.id)));
}

/** How many of `whos` have the status (or any status when `id` is ""). */
export function statusCount(store: string, whos: readonly string[], id: string): number {
  const entries = statusEntries(store);
  return whos.filter((w) => entries.some((e) => e.who === w && (id === "" || e.id === id))).length;
}
