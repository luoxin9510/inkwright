export function resolveRoot(activePath: string | null, locked: string | null): string | null {
  if (locked) return locked;
  return activePath !== null && activePath.endsWith(".ink") ? activePath : null;
}

/**
 * The story to show after focus changes. Without a lock, the current story is
 * kept until another .ink file is opened, so focusing the play panel or a note
 * does not restart or discard it.
 */
export function nextRoot(current: string | null, activePath: string | null, locked: string | null): string | null {
  if (locked) return locked;
  if (activePath !== null && activePath.endsWith(".ink")) return activePath;
  return current;
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

  /** Makes every in-flight run resolve to null. */
  invalidate(): void {
    this.latest++;
  }
}
