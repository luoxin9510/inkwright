export function resolveRoot(activePath: string | null, locked: string | null): string | null {
  if (locked) return locked;
  return activePath !== null && activePath.endsWith(".ink") ? activePath : null;
}

export function isDependency(changedPath: string, files: string[]): boolean {
  return files.includes(changedPath);
}

export type VaultEvent =
  | { type: "delete"; path: string }
  | { type: "rename"; path: string; newPath: string };

export function applyVaultEvent(locked: string | null, ev: VaultEvent): string | null {
  if (locked === null || ev.path !== locked) return locked;
  return ev.type === "delete" ? null : ev.newPath;
}

export class LatestOnly {
  private latest = 0;

  async run<T>(fn: () => Promise<T>): Promise<T | null> {
    const id = ++this.latest;
    const result = await fn();
    return id === this.latest ? result : null;
  }
}
