import type { Payload } from "./session";

/**
 * `#input:<var>` on a choice: the player types a line, it is written into that string VAR just
 * before the choice runs (a payload, like a card played from a hand). Works in any story, game or not.
 */
export function inputOf(choice: { tags: string[] }): string | null {
  for (const tag of choice.tags) {
    const parts = tag.trim().split(":").map((p) => p.trim());
    // #write:<var> is the same with several lines (a paragraph of a journaling game).
    if ((parts[0] === "input" || parts[0] === "write") && parts.length === 2 && parts[1] !== "") return parts[1];
  }
  return null;
}

/** Whether a choice asks for a paragraph (`#write:<var>`, several lines) rather than a line (`#input`). */
export function isWrite(choice: { tags: string[] }): boolean {
  return choice.tags.some((tag) => {
    const parts = tag.trim().split(":").map((p) => p.trim());
    return parts[0] === "write" && parts.length === 2 && parts[1] !== "";
  });
}

/** What an `#input` choice is taken with: the typed text, trimmed; null when nothing was typed. */
export function inputPayload(variable: string, text: string): Payload | null {
  const t = text.trim();
  return t === "" ? null : { var: variable, text: t };
}

/** The text the explorer, the random player and headless play type for a choice when given none. */
export function inputPlaceholder(variable: string): string {
  return `[${variable}]`;
}
