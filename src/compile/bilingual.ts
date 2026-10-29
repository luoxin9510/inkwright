export interface Untranslated {
  line: number;
  /** "bare": text outside any {...} call; "empty": a call with an empty "" side. */
  kind: "bare" | "empty";
}

/** Lines that are logic or declarations, never story text. */
const NOT_TEXT = /^(VAR|CONST|LIST|INCLUDE|EXTERNAL|TODO\b|~|=|->|<-)/;

/**
 * Finds story text not written through a bilingual call such as {双("中文", "English")}.
 * Line-based and heuristic: anything left after removing {...} logic, markers, diverts and tags counts as text.
 */
export function findUntranslated(source: string): Untranslated[] {
  const found: Untranslated[] = [];
  let inComment = false;
  let depth = 0; // open multi-line {...} blocks
  source.split(/\r?\n/).forEach((raw, i) => {
    let line = raw;
    if (inComment) {
      const end = line.indexOf("*/");
      if (end < 0) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open >= 0) {
      line = line.slice(0, open);
      inComment = true;
    }
    line = line.replace(/\/\/.*$/, "").trim();
    if (line === "" || NOT_TEXT.test(line)) return;

    if (/\(\s*""\s*,|,\s*""\s*\)/.test(line)) found.push({ line: i + 1, kind: "empty" });

    let text = line.replace(/"[^"]*"/g, '""');
    if (depth > 0 && /^-(?!>)/.test(text)) {
      // A branch of a multi-line conditional: "- condition:" or "- else:".
      text = text.replace(/^-\s*[^:{}]*:/, "");
    } else {
      text = text.replace(/^([*+]\s*)+/, "").replace(/^(-(?!>)\s*)+/, "").replace(/^\([^)]*\)/, "");
    }
    for (let prev = ""; prev !== text;) {
      prev = text;
      text = text.replace(/\{[^{}]*\}/g, "");
    }
    depth = Math.max(0, depth + (text.match(/\{/g)?.length ?? 0) - (text.match(/\}/g)?.length ?? 0));
    text = text
      .replace(/\{.*$/, "")
      .replace(/\}/g, "")
      .replace(/#.*$/, "")
      .replace(/(->|<-)\s*[^\s\]]*/g, "")
      .replace(/<>|[[\]]/g, "");
    if (/\p{L}/u.test(text)) found.push({ line: i + 1, kind: "bare" });
  });
  return found;
}
