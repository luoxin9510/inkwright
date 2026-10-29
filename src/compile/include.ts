import type { IFileHandler } from "inkjs/compiler/IFileHandler";
import { resolveInclude, scanIncludes } from "./paths";

export type ReadFile = (vaultPath: string) => Promise<string>;

export interface FileCache {
  files: Map<string, string>;
  missing: Set<string>;
}

export async function preload(rootPath: string, readFile: ReadFile): Promise<FileCache> {
  const cache: FileCache = { files: new Map(), missing: new Set() };
  const seen = new Set<string>();
  const queue = [rootPath];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    let source: string;
    try {
      source = await readFile(path);
    } catch {
      cache.missing.add(path);
      continue;
    }
    cache.files.set(path, source);
    for (const name of scanIncludes(source)) queue.push(resolveInclude(rootPath, name));
  }
  return cache;
}

export class CachedFileHandler implements IFileHandler {
  constructor(
    private readonly rootPath: string,
    private readonly cache: FileCache,
  ) {}

  readonly ResolveInkFilename = (filename: string): string =>
    resolveInclude(this.rootPath, filename);

  readonly LoadInkFileContents = (filename: string): string => {
    const content = this.cache.files.get(filename);
    if (content === undefined) throw new Error("Cannot open " + filename);
    return content;
  };
}
