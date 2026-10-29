export function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function resolveInclude(rootPath: string, includeName: string): string {
  return normalizePath(dirname(rootPath) + "/" + includeName);
}

export function scanIncludes(source: string): string[] {
  const names: string[] = [];
  const re = /^[ \t]*INCLUDE[ \t]+(.+?)[ \t\r]*$/gm;
  for (const m of source.matchAll(re)) names.push(m[1]);
  return names;
}
