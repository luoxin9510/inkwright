import { describe, expect, test } from "vitest";
import { RunStore, type Files } from "../src/play/store";
import { newRun, storyFolder, withTaken, type Run } from "../src/play/run";
import type { Taken } from "../src/play/session";

/** A folder tree in memory, like Obsidian's DataAdapter. */
class MemoryFiles implements Files {
  files = new Map<string, string>();
  async exists(p: string) { return this.files.has(p) || [...this.files.keys()].some((k) => k.startsWith(p + "/")); }
  async read(p: string) { const v = this.files.get(p); if (v === undefined) throw new Error("missing " + p); return v; }
  async write(p: string, d: string) { this.files.set(p, d); }
  async mkdir(_p: string) {}
  async remove(p: string) { this.files.delete(p); }
  async rmdir(p: string) { for (const k of [...this.files.keys()]) if (k.startsWith(p + "/")) this.files.delete(k); }
  async rename(a: string, b: string) {
    for (const [k, v] of [...this.files]) if (k.startsWith(a + "/")) { this.files.delete(k); this.files.set(b + k.slice(a.length), v); }
  }
  async list(p: string) {
    const files = new Set<string>(), folders = new Set<string>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(p + "/")) continue;
      const rest = k.slice(p.length + 1);
      const i = rest.indexOf("/");
      if (i < 0) files.add(k); else folders.add(p + "/" + rest.slice(0, i));
    }
    return { files: [...files], folders: [...folders] };
  }
}

const STORY = "游戏/雨夜来客/main.ink";
const NOW = "2026-11-04T10:00:00.000Z";
const taken = (n: number, alt = ""): Taken[] => Array.from({ length: n }, (_, i) => ({ index: 0, text: `c${i}${alt}`, lang: "zh", seq: i, fp: "f" }));
const draft = (device: string) => newRun({ story: STORY, name: "", draft: true, startPoint: null, character: null, device, now: NOW, random: () => 0.5 });
const store = (fs: Files, device: string, sync: "icloud" | "obsidian-sync" | "git" | "local" = "icloud") => new RunStore(fs, { folder: "Inkwright/存档", device, sync });
const dir = `Inkwright/存档/${storyFolder(STORY)}`;

describe("run store", () => {
  test("each device writes its own file; reading merges them; each write is one revision on", async () => {
    const fs = new MemoryFiles();
    const a = store(fs, "A");
    let run = await a.write(withTaken(draft("A"), taken(2), 2, NOW));
    expect(run).toMatchObject({ rev: 1, baseRev: 0, device: "A" });
    expect([...fs.files.keys()]).toEqual([`${dir}/draft/A.json`]);
    run = await a.write(withTaken(run, taken(3), 3, NOW));
    expect(run).toMatchObject({ rev: 2, baseRev: 1 });
    // Device B reads A's run, plays on and writes its own file.
    const b = store(fs, "B");
    const seen = (await b.read(STORY, "draft"))!;
    expect(seen.actions).toHaveLength(3);
    const onB = await b.write(withTaken(seen, taken(4), 4, NOW));
    expect(onB).toMatchObject({ rev: 3, baseRev: 2, device: "B" });
    expect([...fs.files.keys()].sort()).toEqual([`${dir}/draft/A.json`, `${dir}/draft/B.json`]);
    // Back on A: B's longer run is the one to continue.
    expect((await a.read(STORY, "draft"))!.actions).toHaveLength(4);
  });

  test("a back written after the longer copy wins", async () => {
    const fs = new MemoryFiles();
    const a = store(fs, "A"), b = store(fs, "B");
    const r1 = await a.write(withTaken(draft("A"), taken(5), 5, NOW));
    const seen = (await b.read(STORY, "draft"))!;
    await b.write(withTaken(seen, taken(4), 5, NOW)); // a back on B
    expect((await a.read(STORY, "draft"))!.actions).toHaveLength(4);
    expect(r1.rev).toBe(1);
  });

  test("two devices that went different ways at once: both runs are kept, the other as a conflict copy, once", async () => {
    const fs = new MemoryFiles();
    const a = store(fs, "A"), b = store(fs, "B");
    const start = await a.write(withTaken(draft("A"), taken(2), 2, NOW));
    const fromB = (await b.read(STORY, "draft"))!;
    await a.write(withTaken(start, taken(3), 3, NOW));
    await b.write(withTaken(fromB, taken(3, "'"), 3, "2026-11-04T09:00:00.000Z"));
    const runs = await a.list(STORY);
    // B wrote last, so B's way is the run; A's is kept as a conflict copy.
    const main = runs.find((r) => r.id === "draft")!;
    const fork = runs.find((r) => r.conflictOf === "draft")!;
    expect(runs).toHaveLength(2);
    expect(main.actions.map((x) => x.kind === "choose" && x.text)).toEqual(["c0'", "c1'", "c2'"]);
    expect(fork.actions.map((x) => x.kind === "choose" && x.text)).toEqual(["c0", "c1", "c2"]);
    expect(fork.draft).toBe(false);
    const again = await a.list(STORY);
    expect(again).toHaveLength(2);
    // The next write on A has seen B's copy: no conflict any more.
    const merged = (await a.read(STORY, "draft"))!;
    await a.write(withTaken(merged, taken(4), 4, NOW));
    expect((await a.list(STORY)).filter((r) => r.conflictOf === undefined)).toHaveLength(1);
  });

  test("iCloud's own conflict copies (\"A 2.json\") are merged and cleaned up once superseded", async () => {
    const fs = new MemoryFiles();
    const a = store(fs, "A");
    const r = await a.write(withTaken(draft("A"), taken(2), 2, NOW));
    fs.files.set(`${dir}/draft/A 2.json`, JSON.stringify(r));
    await a.write(withTaken(r, taken(3), 3, NOW));
    await a.list(STORY);
    expect([...fs.files.keys()]).toEqual([`${dir}/draft/A.json`]);
    // Other sync modes leave such files alone.
    const fs2 = new MemoryFiles();
    const g = store(fs2, "A", "git");
    const r2 = await g.write(withTaken(draft("A"), taken(2), 2, NOW));
    fs2.files.set(`${dir}/draft/A 2.json`, JSON.stringify(r2));
    await g.write(withTaken(r2, taken(3), 3, NOW));
    await g.list(STORY);
    expect(fs2.files.size).toBe(2);
  });

  test("local only: one file per run whatever the device", async () => {
    const fs = new MemoryFiles();
    const l = store(fs, "A", "local");
    await l.write(withTaken(draft("A"), taken(1), 1, NOW));
    expect([...fs.files.keys()]).toEqual([`${dir}/draft/local.json`]);
  });

  test("list: newest first; remove; a story's runs follow it when it is renamed", async () => {
    const fs = new MemoryFiles();
    const a = store(fs, "A");
    await a.write(withTaken(draft("A"), taken(1), 1, "2026-11-04T10:00:00.000Z"));
    const saved = newRun({ story: STORY, name: "存档 1", draft: false, startPoint: null, character: null, device: "A", now: NOW });
    await a.write({ ...saved, updatedAt: "2026-11-04T12:00:00.000Z" });
    expect((await a.list(STORY)).map((r) => r.name)).toEqual(["存档 1", ""]);
    await a.remove(STORY, saved.id);
    expect((await a.list(STORY)).map((r) => r.id)).toEqual(["draft"]);
    await a.move(STORY, "游戏/雨夜/main.ink");
    expect(await a.list(STORY)).toEqual([]);
    const moved = await a.list("游戏/雨夜/main.ink");
    expect(moved.map((r) => [r.id, r.story])).toEqual([["draft", "游戏/雨夜/main.ink"]]);
  });

  test("the pending actions are never written; a broken file is skipped, not fatal", async () => {
    const fs = new MemoryFiles();
    const a = store(fs, "A");
    const r: Run = { ...withTaken(draft("A"), taken(1), 1, NOW), pending: [{ kind: "choose", seq: 5, lang: "zh", index: 0, text: "x", fp: "" }] };
    await a.write(r);
    expect(JSON.parse(fs.files.get(`${dir}/draft/A.json`)!).pending).toBeUndefined();
    fs.files.set(`${dir}/draft/B.json`, "{ not json");
    expect((await a.read(STORY, "draft"))!.actions).toHaveLength(1);
    expect(await a.read(STORY, "nothing")).toBeNull();
  });

  test("tells its own files from the others' and from the rest of the vault", () => {
    const a = store(new MemoryFiles(), "A");
    expect(a.isRunFile(`${dir}/draft/B.json`)).toBe(true);
    expect(a.isRunFile("Inkwright/存档x/foo.json")).toBe(false);
    expect(a.isOwnFile(`${dir}/draft/A.json`)).toBe(true);
    expect(a.isOwnFile(`${dir}/draft/B.json`)).toBe(false);
  });
});
