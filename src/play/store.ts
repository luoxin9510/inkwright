import { hash, mergeRuns, storyFolder, type Run } from "./run";

/** The part of Obsidian's DataAdapter the store uses (paths relative to the vault). */
export interface Files {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

/** How the vault is synced: only changes how conflicts are handled. */
export type SyncMode = "icloud" | "obsidian-sync" | "git" | "local";
export const SYNC_MODES: readonly SyncMode[] = ["icloud", "obsidian-sync", "git", "local"];

export interface StoreOptions {
  /** Vault folder the runs live in, e.g. "Inkwright/存档". */
  folder: string;
  /** This device's id (kept in local storage, not synced). */
  device: string;
  sync: SyncMode;
}

/**
 * Runs saved in a vault folder: `<folder>/<story folder>/<run id>/<device>.json`. Each device writes only
 * its own file, so no sync can make one device's write overwrite another's; reading merges the copies
 * (see mergeRuns), keeps a copy that went its own way as a conflict run, and in iCloud mode removes
 * iCloud's own conflict copies ("A 2.json") once they are superseded.
 */
export class RunStore {
  private readonly folder: string;
  private readonly device: string;
  private readonly sync: SyncMode;

  constructor(private readonly files: Files, o: StoreOptions) {
    this.folder = o.folder.replace(/\/+$/, "");
    this.sync = o.sync;
    this.device = o.sync === "local" ? "local" : o.device;
  }

  /** Whether a vault path is one of the run files. */
  isRunFile(path: string): boolean {
    return path.startsWith(this.folder + "/") && path.endsWith(".json");
  }

  /** Whether a vault path is a run file this device wrote (its own writes are not news). */
  isOwnFile(path: string): boolean {
    return this.isRunFile(path) && path.endsWith(`/${this.device}.json`);
  }

  private storyDir(story: string): string {
    return `${this.folder}/${storyFolder(story)}`;
  }

  /** Every run of a story, merged, newest first (conflict copies included as runs of their own). */
  async list(story: string): Promise<Run[]> {
    const dir = this.storyDir(story);
    if (!(await this.files.exists(dir))) return [];
    const { folders } = await this.files.list(dir);
    const runs: Run[] = [];
    for (const f of folders) {
      const id = f.slice(f.lastIndexOf("/") + 1);
      const read = await this.readRun(story, id);
      if (read) runs.push(read.run, ...read.conflicts);
    }
    const seen = new Set<string>();
    return runs
      .filter((r) => !seen.has(r.id) && seen.add(r.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** One run, merged from every device's copy; null when there is none. */
  async read(story: string, id: string): Promise<Run | null> {
    return (await this.readRun(story, id))?.run ?? null;
  }

  private async readRun(story: string, id: string): Promise<{ run: Run; conflicts: Run[] } | null> {
    const dir = `${this.storyDir(story)}/${id}`;
    if (!(await this.files.exists(dir))) return null;
    const copies: { path: string; run: Run }[] = [];
    for (const path of (await this.files.list(dir)).files) {
      if (!path.endsWith(".json")) continue;
      try {
        const run = JSON.parse(await this.files.read(path)) as Run;
        if (run && run.schema === 1 && Array.isArray(run.actions)) copies.push({ path, run: { ...run, story } });
      } catch {
        // A copy still being synced, or broken: the others are enough.
      }
    }
    if (copies.length === 0) return null;
    const merged = mergeRuns(copies.map((c) => c.run));
    if (this.sync === "icloud") {
      // iCloud keeps both sides of a conflict as "A 2.json": once the winner includes one, it can go.
      for (const c of copies) {
        if (/ \d+\.json$/.test(c.path) && merged.superseded.includes(c.run)) await this.files.remove(c.path).catch(() => undefined);
      }
    }
    // A copy that went its own way is kept as a run of its own (the id follows its actions, so it is made once).
    const conflicts: Run[] = [];
    for (const c of merged.conflicts) {
      const fork: Run = { ...c, id: `${id}-${hash(JSON.stringify(c.actions))}`, draft: false, conflictOf: id, device: this.device, rev: 0, baseRev: 0 };
      if (!(await this.files.exists(`${this.storyDir(story)}/${fork.id}`))) await this.write(fork);
      conflicts.push(fork);
    }
    return { run: merged.run, conflicts };
  }

  /**
   * Writes this device's copy of a run, one revision past every copy there is; returns the run as written.
   * The run's own `rev` is the revision it was read or last written at: copies up to it were seen.
   */
  async write(run: Run): Promise<Run> {
    const dir = `${this.storyDir(run.story)}/${run.id}`;
    let top = run.rev;
    if (await this.files.exists(dir)) {
      for (const path of (await this.files.list(dir)).files) {
        try {
          top = Math.max(top, (JSON.parse(await this.files.read(path)) as Run).rev ?? 0);
        } catch {
          // ignore a broken copy
        }
      }
    }
    const { pending: _pending, ...rest } = run;
    const written: Run = { ...rest, device: this.device, rev: top + 1, baseRev: run.rev };
    await this.ensure(dir);
    await this.files.write(`${dir}/${this.device}.json`, JSON.stringify(written));
    return written;
  }

  /** Removes a run (every device's copy). */
  async remove(story: string, id: string): Promise<void> {
    const dir = `${this.storyDir(story)}/${id}`;
    if (await this.files.exists(dir)) await this.files.rmdir(dir, true);
  }

  /** A story was renamed or moved: its runs go with it. */
  async move(from: string, to: string): Promise<void> {
    const a = this.storyDir(from), b = this.storyDir(to);
    if (a === b || !(await this.files.exists(a)) || (await this.files.exists(b))) return;
    await this.files.rename(a, b);
  }

  private async ensure(dir: string): Promise<void> {
    const parts = dir.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      if (!(await this.files.exists(p))) await this.files.mkdir(p);
    }
  }
}
