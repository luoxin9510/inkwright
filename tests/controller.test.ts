import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { RunController, type RunHost, type StoryVersion } from "../src/play/controller";
import { RunStore } from "../src/play/store";
import { MemoryFiles } from "./memory-files";

const ROOT = "游戏/路口/main.ink";

/** A story of three choices in a row; `second` is the middle screen's first choice, so an edit can change it (an edit that rewords it and adds another changes the screen too much to guess). */
const source = (second = "Left") => `-> a
=== a ===
Start.
+ [Go] -> b
=== b ===
At the fork.
+ [${second}] -> c
+ [Right] -> c
=== c ===
Near the end.
+ [Finish] -> d
=== d ===
The end.
-> END
`;

const version = (src: string): StoryVersion => ({ story: new Compiler(src).Compile(), engine: null, hash: `h${src.length}${src.slice(40, 60)}` });

interface Rig {
  run: RunController;
  fs: MemoryFiles;
  notes: string[];
  settings: { playerMode: boolean };
}

function rig(fs = new MemoryFiles(), device = "A", playerMode = false): Rig {
  const store = new RunStore(fs, { folder: "存档", device, sync: "icloud" });
  const notes: string[] = [];
  const settings = { playerMode };
  let t = Date.parse("2026-11-10T10:00:00Z");
  const host: RunHost = {
    store: () => store,
    playerMode: () => settings.playerMode,
    storyLanguage: () => null,
    notify: (m) => notes.push(m),
    changed: () => {},
    now: () => new Date((t += 1000)),
    wait: () => Promise.resolve(),
    replayBudget: 5000,
  };
  return { run: new RunController(host), fs, notes, settings };
}

/** Waits for a replay under way, then for the writes queued. */
async function idle(c: RunController): Promise<void> {
  for (let i = 0; i < 100 && c.replaying; i++) await Promise.resolve();
  // A replay yields through several awaits; give it a few turns of the queue.
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  await c.settled();
}

const text = (c: RunController) => c.session?.log.map((p) => p.text.trim()).join(" | ") ?? "";
const runFiles = (fs: MemoryFiles) => [...fs.files.keys()].filter((k) => k.endsWith(".json") && k.includes("/runs/"));

describe("run controller", () => {
  test("a new version plays without writing; each move writes the draft", async () => {
    const { run, fs } = rig();
    await run.compiledVersion(ROOT, version(source()), []);
    await idle(run);
    expect(run.last?.choices.map((c) => c.text)).toEqual(["Go"]);
    expect(fs.files.size).toBe(0);
    run.choose(0);
    run.choose(0);
    await idle(run);
    expect(text(run)).toContain("At the fork.");
    const draft = await new RunStore(fs, { folder: "存档", device: "B", sync: "icloud" }).read(ROOT, "draft");
    expect(draft?.actions.map((a) => a.text)).toEqual(["Go", "Left"]);
  });

  test("a story opened again picks the run up where it was", async () => {
    const a = rig();
    await a.run.compiledVersion(ROOT, version(source()), []);
    a.run.choose(0);
    a.run.choose(1);
    await idle(a.run);
    const b = rig(a.fs);
    await b.run.compiledVersion(ROOT, version(source()), []);
    await idle(b.run);
    expect(text(b.run)).toBe(text(a.run));
    expect(b.run.last?.choices.map((c) => c.text)).toEqual(["Finish"]);
  });

  test("back takes the last choice back and writes it", async () => {
    const { run, fs } = rig();
    await run.compiledVersion(ROOT, version(source()), []);
    run.choose(0);
    run.choose(0);
    run.back();
    await idle(run);
    expect(run.last?.choices.map((c) => c.text)).toEqual(["Left", "Right"]);
    const draft = await new RunStore(fs, { folder: "存档", device: "A", sync: "icloud" }).read(ROOT, "draft");
    expect(draft?.actions.map((a) => a.text)).toEqual(["Go"]);
  });

  test("an edit that removes a choice taken stops the run there, without touching the saved run", async () => {
    const { run, fs } = rig();
    await run.compiledVersion(ROOT, version(source()), []);
    run.choose(0);
    run.choose(0);
    run.choose(0);
    await idle(run);
    const before = JSON.stringify([...fs.files.entries()].filter(([k]) => !k.includes("/builds/")));
    await run.compiledVersion(ROOT, version(source("Up] -> c\n+ [Down")), []);
    await idle(run);
    expect(run.stopped?.reason).toBe("mismatch");
    expect(run.stopped?.step).toBe(2);
    expect(run.stopped?.pending).toBe(2);
    expect(run.stopped?.older).toBe(true);
    expect(JSON.stringify([...fs.files.entries()].filter(([k]) => !k.includes("/builds/")))).toBe(before);

    // Back to before the edit: the whole run plays on the version it was played on, and new compiles leave it be.
    await run.useOlder();
    await idle(run);
    expect(run.stopped).toBeNull();
    expect(run.frozen?.story).toBe(ROOT);
    expect(text(run)).toContain("The end.");
    await run.compiledVersion(ROOT, version(source("Up] -> c\n+ [Down")), []);
    await idle(run);
    expect(text(run)).toContain("The end.");

    // The newest again: it stops where the edit is.
    run.useNewest();
    await idle(run);
    expect(run.frozen).toBeNull();
    expect(run.stopped?.reason).toBe("mismatch");
  });

  test("moving on from a stop keeps the whole run as a save first", async () => {
    const { run } = rig();
    await run.compiledVersion(ROOT, version(source()), []);
    run.choose(0);
    run.choose(0);
    run.choose(0);
    await idle(run);
    await run.compiledVersion(ROOT, version(source("Up] -> c\n+ [Down")), []);
    await idle(run);
    run.choose(1);
    await idle(run);
    expect(run.stopped).toBeNull();
    expect(run.saves).toHaveLength(1);
    expect(run.run?.pending).toBeUndefined();
  });

  test("go on by index takes the pending steps whatever is there now", async () => {
    const { run } = rig();
    await run.compiledVersion(ROOT, version(source()), []);
    run.choose(0);
    run.choose(0);
    run.choose(0);
    await idle(run);
    await run.compiledVersion(ROOT, version(source("Up] -> c\n+ [Down")), []);
    await idle(run);
    await run.continueByIndex();
    await idle(run);
    expect(run.stopped).toBeNull();
    expect(text(run)).toContain("The end.");
  });

  test("player mode: an edit waits as an update until applied", async () => {
    const { run } = rig(undefined, "A", true);
    await run.compiledVersion(ROOT, version(source()), []);
    run.choose(0);
    await idle(run);
    await run.compiledVersion(ROOT, version(source("Up] -> c\n+ [Down")), []);
    expect(run.update).toBe(true);
    expect(run.last?.choices.map((c) => c.text)).toEqual(["Left", "Right"]);
    run.useNewest();
    await idle(run);
    expect(run.update).toBe(false);
    expect(run.last?.choices.map((c) => c.text)).toEqual(["Up", "Down", "Right"]);
  });

  test("player mode: restarting keeps the run so far as a save", async () => {
    const { run } = rig(undefined, "A", true);
    await run.compiledVersion(ROOT, version(source()), []);
    run.choose(0);
    run.restart();
    await idle(run);
    expect(run.saves).toHaveLength(1);
    expect(run.last?.choices.map((c) => c.text)).toEqual(["Go"]);
  });

  test("another device's moves are read with the next version", async () => {
    const fs = new MemoryFiles();
    const a = rig(fs, "A"), b = rig(fs, "B");
    await a.run.compiledVersion(ROOT, version(source()), []);
    await b.run.compiledVersion(ROOT, version(source()), []);
    a.run.choose(0);
    await idle(a.run);
    expect(await b.run.synced()).toBe(true);
    await b.run.compiledVersion(ROOT, version(source()), []);
    await idle(b.run);
    expect(b.run.last?.choices.map((c) => c.text)).toEqual(["Left", "Right"]);
    // Nothing new there: nothing to read again.
    expect(await b.run.synced()).toBe(false);
  });

  test("saves are snapshots: loading one replays it into the draft", async () => {
    const { run } = rig();
    await run.compiledVersion(ROOT, version(source()), []);
    run.choose(0);
    const saved = await run.save("岔路口");
    run.choose(1);
    await idle(run);
    expect(saved?.name).toBe("岔路口");
    expect(run.saves.map((s) => s.name)).toEqual(["岔路口"]);
    await run.load(saved!.id);
    await idle(run);
    expect(run.last?.choices.map((c) => c.text)).toEqual(["Left", "Right"]);
    await run.remove(saved!.id);
    expect(run.saves).toEqual([]);
  });

  test("a failed compile drops the session; moves are refused", async () => {
    const { run, fs } = rig();
    await run.compiledVersion(ROOT, version(source()), []);
    await run.compiledVersion(ROOT, null, []);
    expect(run.session).toBeNull();
    run.choose(0);
    await idle(run);
    expect(runFiles(fs)).toEqual([]);
  });
});
