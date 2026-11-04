/**
 * How a replay finds each recorded choice: "strict" only at its index with its text; "match" also by its
 * text being unique on the screen, or (a guess) by its text with the numbers left out being unique, or by it
 * being the one choice reworded on a screen that otherwise did not change; "index" whatever is at its index.
 */
export type ReplayMode = "strict" | "match" | "index";

/**
 * Where a recorded choice is on the screen now (`texts`: the choices offered, in order), by the replay mode's
 * rules; null when it is not there. Used by the panel (PlaySession.replay) and, as its source text, by the
 * exported web page: so it must stay self-contained (no imports, no helpers outside it).
 */
export function findChoice(
  texts: readonly string[],
  a: { index: number; text: string | null; offered?: readonly string[] },
  mode: ReplayMode,
  sameLanguage: boolean,
): { index: number; guess: boolean } | null {
  // Numbers left out, so "付 3 金" and "付 5 金" read the same.
  const withoutNumbers = (t: string) => t.replace(/\d+/g, "#");
  if (a.index < 0) return null;
  const atIndex = a.index < texts.length;
  // Recorded without text, in another language, or told to: the index is all there is.
  if (mode === "index" || a.text === null || !sameLanguage) return atIndex ? { index: a.index, guess: false } : null;
  if (atIndex && texts[a.index] === a.text) return { index: a.index, guess: false };
  if (mode === "strict") return null;
  const only = (pred: (t: string) => boolean) => {
    const hits: number[] = [];
    texts.forEach((t, i) => {
      if (pred(t)) hits.push(i);
    });
    return hits.length === 1 ? hits[0] : null;
  };
  const text = a.text;
  const same = only((t) => t === text);
  if (same !== null) return { index: same, guess: false };
  const numbers = only((t) => withoutNumbers(t) === withoutNumbers(text));
  if (numbers !== null) return { index: numbers, guess: true };
  // Reworded: the screen has as many choices, every other one as it was.
  const before = a.offered;
  if (atIndex && before && before.length === texts.length && before.every((t, i) => i === a.index || t === texts[i])) return { index: a.index, guess: true };
  return null;
}
