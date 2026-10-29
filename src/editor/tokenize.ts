export type TokenKind =
  | "knot" | "stitch" | "choice" | "gather" | "divert"
  | "logic" | "keyword" | "comment" | "tag";

export interface Token {
  from: number;
  to: number;
  kind: TokenKind;
}

export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const commentIdx = line.indexOf("//");
  const codeEnd = commentIdx < 0 ? line.length : commentIdx;

  const whole = /^\s*(?:={2,}|=(?!=)|~)/.exec(line.slice(0, codeEnd));
  if (whole) {
    const text = whole[0].trim();
    const kind: TokenKind = text.startsWith("~") ? "logic" : text.length >= 2 ? "knot" : "stitch";
    tokens.push({ from: whole[0].length - text.length, to: codeEnd, kind });
  } else {
    const tagIdx = line.slice(0, codeEnd).indexOf("#");
    const bodyEnd = tagIdx < 0 ? codeEnd : tagIdx;
    const body = line.slice(0, bodyEnd);

    const kw = /^(\s*)(VAR|CONST|LIST|INCLUDE|EXTERNAL)\b/.exec(body);
    if (kw) {
      tokens.push({ from: kw[1].length, to: kw[1].length + kw[2].length, kind: "keyword" });
    } else {
      const choice = /^(\s*)([*+](?:\s*[*+])*)/.exec(body);
      const gather = choice ? null : /^(\s*)(-(?!>)(?:\s*-(?!>))*)/.exec(body);
      const marker = choice ?? gather;
      if (marker) {
        tokens.push({
          from: marker[1].length,
          to: marker[1].length + marker[2].length,
          kind: choice ? "choice" : "gather",
        });
      }
      for (const m of body.matchAll(/(?:->|<-)[ \t]*[^\s\[\]{}|#]*/g)) {
        tokens.push({ from: m.index!, to: m.index! + m[0].length, kind: "divert" });
      }
    }
    if (tagIdx >= 0) tokens.push({ from: tagIdx, to: codeEnd, kind: "tag" });
  }

  if (commentIdx >= 0) tokens.push({ from: commentIdx, to: line.length, kind: "comment" });
  return tokens.sort((a, b) => a.from - b.from);
}
