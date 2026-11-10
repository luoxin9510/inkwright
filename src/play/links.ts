/**
 * Note links in the story's text (solo PRD §4.9): `[[note]]` and `[[note|shown text]]`. The panel draws them as
 * links into the vault; the exported page, which has no vault, shows the text only; the journal keeps them as
 * they are (they are links in a note).
 */
export type LinkPart = { text: string; link?: string };

const LINK = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;

/** A paragraph as text and links, in order. */
export function splitLinks(text: string): LinkPart[] {
  const out: LinkPart[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const target = m[1].trim();
    out.push({ link: target, text: (m[2] ?? m[1]).trim() });
    last = at + m[0].length;
  }
  if (last < text.length || out.length === 0) out.push({ text: text.slice(last) });
  return out;
}

/**
 * The paragraph with each link replaced by its shown text. Self-contained on purpose: the exported page embeds
 * its source (withoutLinks.toString()), like findChoice.
 */
export function withoutLinks(text: string): string {
  return text.replace(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g, (_m, target: string, shown?: string) => (shown ?? target).trim());
}
