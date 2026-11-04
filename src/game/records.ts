/**
 * A record (solo PRD §4.5: clues, people, threads) is one ink string variable holding its entries, kept in
 * order: `;` between entries, `\\` and `;` in an entry escaped with `\\`. Pure, so the engine can bind these as
 * lookahead-safe EXTERNALs and the session can make the player's changes with them. The ink fallback (no
 * engine) joins with a plain `;`, which reads back the same as long as no entry has one.
 */

/** The entries of a store, in order. */
export function recordEntries(store: string): string[] {
  if (store === "") return [];
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < store.length; i++) {
    const c = store[i];
    if (c === "\\" && i + 1 < store.length) cur += store[++i];
    else if (c === ";") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.filter((e) => e !== "");
}

/** A store holding these entries. */
export function recordStore(entries: readonly string[]): string {
  return entries.filter((e) => e !== "").map((e) => e.replace(/[\\;]/g, (c) => `\\${c}`)).join(";");
}

/** The store with an entry added at the end (an empty entry adds nothing). */
export function recordAdd(store: string, entry: string): string {
  return recordStore([...recordEntries(store), entry.trim()]);
}

/** The store without the first entry equal to this one (unchanged when there is none). */
export function recordDrop(store: string, entry: string): string {
  const entries = recordEntries(store);
  const i = entries.indexOf(entry);
  if (i < 0) return store;
  entries.splice(i, 1);
  return recordStore(entries);
}

/** The k-th entry (1-based); "" past the end. */
export function recordAt(store: string, k: number): string {
  return recordEntries(store)[Math.floor(k) - 1] ?? "";
}
