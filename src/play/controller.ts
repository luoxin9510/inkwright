import { Story } from "inkjs/full";
import type { Flow } from "../compile/compile";
import { seededDice, type Rng } from "../game/dice";
import { GameEngine } from "../game/engine";
import { inkNames, playableCharacters, type GameConfig } from "../game/config";
import { T, getLanguage } from "../i18n";
import { inputOf, inputPayload } from "./input";
import { askOracle, oracleRules, rollTray, type Odds } from "./oracle";
import { newRun, replayActions, stepAt, withTaken, type Run } from "./run";
import { PlaySession, type Chosen, type Payload, type ReplayAction, type Step } from "./session";
import type { RunStore } from "./store";

/** A compiled story with the engine for its game note, and a hash of both: one version of a story. */
export interface StoryVersion {
  story: Story;
  engine: GameEngine | null;
  hash: string;
}

/** A saved run as the panel and the API list it. */
export interface SaveInfo {
  id: string;
  name: string;
  savedAt: string;
}

/** Why the panel stopped short of where the run had got to; the run itself is left as it was. */
export interface Stopped {
  /** "chosen": the player stopped it at the step whose outcome changed. */
  reason: "mismatch" | "error" | "budget" | "start" | "character" | "chosen";
  /** The version the run was last played on is kept: "back to before the edit" can play it. */
  older?: boolean;
  /** The step (1-based) the story stopped at. */
  step: number;
  /** Steps of the run not replayed: kept until the player does something new here. */
  pending: number;
  /** The missing start point or character. */
  detail?: string;
}

/** What a replay noticed without stopping: steps found by a guess, hand changes skipped, the first step whose outcome changed. */
export interface ReplayNote {
  guesses: number;
  skipped: number;
  drift: number | null;
  driftAt: number | null;
}

/** What the controller needs from where it runs (the plugin, or a test). */
export interface RunHost {
  /** Where runs are saved; it can change with the settings. */
  store(): RunStore | null;
  playerMode(): boolean;
  /** The story language the player picked (null: each story's own). */
  storyLanguage(): string | null;
  /** Something the player should read (a write that failed, a formula the tray cannot roll). */
  notify(message: string): void;
  /** The state changed: draw it. */
  changed(): void;
  now(): Date;
  /** Lets the app breathe during a replay. */
  wait(): Promise<void>;
  /** How long a replay may take before it stops (ms). */
  replayBudget: number;
  /** After a move is recorded and before the run is written (the live journal); may `enqueue` work. */
  afterMove?(): void;
}

/**
 * The run being played (docs/solo-prd.md §4.0–4.1): the player's moves on a story, kept as a run in the save
 * folder, and played on the compiled story by replaying them. Owns the session, the run, the version played,
 * the replay and its stops, and the order runs are written in. Only the player's moves write: a replay, a stop
 * or a new version never does, so none of them can overwrite a run with less than it had. Every move is refused
 * while a replay is under way.
 */
export class RunController {
  root: string | null = null;
  session: PlaySession | null = null;
  /** The last step shown (its choices are on screen). */
  last: Step | null = null;
  /** The run being played: the story's draft. */
  run: Run | null = null;
  /** Rules engine of the version played; null for plain stories. */
  game: GameEngine | null = null;
  startPoint: string | null = null;
  /** Chosen playable character; null = the game's first. */
  character: string | null = null;
  /** Progress of a replay under way; null when none is. */
  replaying: { done: number; total: number } | null = null;
  stopped: Stopped | null = null;
  note: ReplayNote | null = null;
  /** Player mode: a newer version of the story is waiting to be applied. */
  update = false;
  /** The run was picked up after a while: the paragraph count where the player left off, and when. */
  recap: { at: number; when: string } | null = null;
  /** An older version the player went back to ("back to before the edit"); new versions leave it alone until the newest is applied. */
  frozen: { story: string; hash: string; createdAt: string } | null = null;
  /** Saved runs of the current story (not the draft), for the saves list. */
  saves: SaveInfo[] = [];

  private flows: Flow[] = [];
  /** The compiled story the session plays, so a run can be restarted or loaded without compiling again. */
  private compiled: Story | null = null;
  private replayAbort: AbortController | null = null;
  /** Another device changed the run: read it again with the next version. */
  private runDirty = false;
  /** The latest compiled version of the story. */
  private newest: StoryVersion | null = null;
  /** The version being played: written with the run, kept as a build when the player plays on it. */
  private buildHash: string | null = null;
  /** Builds known to be kept (this session), so each is written once. */
  private storedBuilds = new Set<string>();
  /** The whole run was saved before the pending steps are dropped: once per stop. */
  private backedUp = false;
  /** The run was just read from the save folder: a replay may show a recap. */
  private resuming = false;
  /** Bumped by every new version, so an older one still reading the draft gives way. */
  private generation = 0;
  /** Writes of the run, one after another. */
  private writing: Promise<void> = Promise.resolve();
  /** A write is queued and has not started: it will write the latest run, so another is not needed. */
  private writeQueued = false;

  constructor(private readonly host: RunHost) {}

  // --- versions ---

  /**
   * A compile of `root` finished: `version` is what it made (null when it failed; `engine` is then the game note's
   * engine, if any). Reads the story's run when the story changed or another device moved it on, then plays it on
   * the new version, unless an older version is being played on purpose, or, in player mode, the run in memory
   * keeps its version until the update is applied.
   */
  async compiledVersion(root: string, version: StoryVersion | null, flows: Flow[], engine: GameEngine | null = version?.engine ?? null): Promise<void> {
    const generation = ++this.generation;
    if (root !== this.root) {
      this.startPoint = null;
      this.character = null;
    }
    this.root = root;
    const read = this.run?.story !== root || this.runDirty ? await this.readDraft(root) : null;
    if (generation !== this.generation) return;
    if (read) {
      this.run = read;
      this.runDirty = false;
      this.resuming = true;
      void this.refreshSaves();
    }
    this.flows = flows;
    if (version) {
      this.newest = version;
      // Playing an older version on purpose: the edit shows in the diagnostics and the graph, the run is not touched.
      if (this.frozen && this.frozen.story === root) return this.host.changed();
      // Player mode: an edit does not interrupt the run; it plays on its version until the update is applied.
      if (this.host.playerMode() && !read && this.session && this.compiled && this.buildHash !== null && version.hash !== this.buildHash) {
        this.update = true;
        return this.host.changed();
      }
      this.update = false;
      this.frozen = null;
      this.useVersion(version);
      this.playRun();
    } else if (this.frozen && this.frozen.story === root) {
      this.host.changed();
    } else {
      this.game = engine;
      this.replayAbort?.abort();
      this.replaying = null;
      this.session = null;
      this.last = null;
      this.host.changed();
    }
  }

  /** No story to play. */
  close(): void {
    this.generation++;
    this.root = null;
    this.replayAbort?.abort();
    this.replaying = null;
    this.session = null;
    this.game = null;
    this.flows = [];
    this.last = null;
  }

  /**
   * A run file changed on another device. Returns true when the run there is not the one here: it is read again with
   * the next version (compile again). A local write still queued lands first, so the disk is not taken for older.
   */
  async synced(): Promise<boolean> {
    const root = this.root, store = this.host.store();
    if (root === null || !store) return false;
    await this.writing;
    await this.refreshSaves();
    const there = await store.read(root, "draft");
    const here = this.run;
    if (!there || !here || there.story !== root) return false;
    const same = (r: Run) => JSON.stringify([r.actions, r.startPoint, r.character, r.seeds, r.legacy ?? null]);
    if (same(there) === same(here)) {
      // Nothing to replay; just remember the newer revision so the next write is based on it.
      if (there.rev > here.rev) this.run = { ...here, rev: there.rev };
      return false;
    }
    this.runDirty = true;
    return true;
  }

  /** Resolves when every write queued so far has landed. */
  settled(): Promise<void> {
    return this.writing;
  }

  /** Queues work after the writes queued so far (the live journal's). */
  enqueue(task: () => Promise<void>): void {
    this.writing = this.writing.then(task);
  }

  /** Records how far the live journal got (and where), and writes the run with it. */
  recordJournal(journal: NonNullable<Run["journal"]>): void {
    if (!this.run) return;
    this.run = { ...this.run, journal };
    this.writeRun();
  }

  // --- the player's moves ---

  startAt(path: string | null): void {
    this.startPoint = path;
    if (!this.session || this.replaying) return;
    this.freshDraft();
    this.apply(this.session.startAt(path));
    this.persist();
  }

  /** "Restart" starts the draft over (new seeds), from the same start point and character. */
  restart(): void {
    if (!this.session || this.replaying) return;
    this.freshDraft();
    this.apply(this.session.startAt(this.startPoint));
    this.persist();
  }

  choose(index: number, value?: string | string[]): void {
    if (!this.session || this.replaying) return;
    // A choice that needs an item not carried is shown locked; it cannot be taken.
    const choice = this.last?.choices.find((c) => c.index === index);
    if (choice && this.game && !this.game.canChoose(choice)) return;
    // A #play choice is taken with a card from its hand: the engine writes it into the played VAR first.
    let payload: Payload | undefined;
    const play = choice && this.game ? this.game.playOf(choice) : null;
    if (play && this.game) {
      // Several cards (#play:hand:1-3) come as a list; one card as its id (a list for a choice that takes several).
      const p = value === undefined ? null
        : Array.isArray(value) ? this.game.playPayload(play.hand, value, play)
        : play.max > 1 ? this.game.playPayload(play.hand, [value], play) : this.game.playPayload(play.hand, value);
      if (!p) return;
      payload = p;
    } else {
      // An #input choice is taken with the line typed: it is written into its VAR first.
      const variable = choice ? inputOf(choice) : null;
      if (variable !== null) {
        const p = inputPayload(variable, typeof value === "string" ? value : "");
        if (!p) return;
        payload = p;
      }
    }
    this.apply(this.session.choose(index, payload));
    this.persist();
  }

  /** Takes back the latest thing done: a choice, or a question or roll on the dice tray. */
  back(): void {
    if (this.replaying) return;
    const step = this.session?.undo();
    if (!step) return;
    this.apply(step);
    this.persist();
  }

  selectCharacter(id: string): void {
    if (this.replaying || !this.game || !playableCharacters(this.game.config).some((c) => c.id === id)) return;
    this.character = id;
    // A new character means a new run from the current start point.
    this.startAt(this.startPoint);
  }

  /** The record of the run is rewritten in the new language as the run replays in it. */
  setLanguage(lang: string): void {
    if (this.replaying || !this.session) return;
    this.apply(this.session.setLanguage(lang));
    this.persist();
  }

  /** Asks the oracle a yes/no question (the question is optional); the answer is kept in the run. */
  askOracle(question: string, odds: Odds): void {
    const session = this.session, rng = this.trayDice();
    if (!session || !rng) return;
    const config = this.game?.config;
    const chaos = config?.resources.find((r) => r.id === config.oracle?.chaos);
    const rules = oracleRules(config?.oracle, (id) => session.read(id), chaos ? { min: chaos.min, max: chaos.max } : undefined);
    const result = askOracle(odds, rules, rng);
    const q = question.trim();
    session.addAside({ kind: "oracle", lang: session.language, ...(q ? { question: q } : {}), odds, result });
    this.moved();
  }

  /** Rolls a formula on the tray (as `roll()` reads it), or one of the game's tables marked for it. */
  rollTray(formula: string, table?: string): void {
    const session = this.session, rng = this.trayDice();
    if (!session || !rng) return;
    const def = table === undefined ? undefined : this.game?.config.tables?.find((t) => t.id === table);
    if (table !== undefined && !def) return;
    const result = rollTray(formula, def ? { table: def, language: session.language ?? getLanguage() } : undefined, rng);
    if (!result) {
      this.host.notify(T().badFormulaNamed(formula));
      return;
    }
    session.addAside({ kind: "roll", lang: session.language, formula: result.formula, ...(def ? { table: def.id } : {}), result });
    this.moved();
  }

  /** The player changes a resource by hand (one marked `manual`): by `delta`, or to `value`. Shows from the next choice on. */
  adjustResource(id: string, delta: number, value?: number): void {
    const session = this.session;
    if (!session || this.replaying) return;
    const def = this.game?.config.resources.find((r) => r.id === id);
    if (!def?.manual) return;
    const placed = value === undefined
      ? session.applyManual({ kind: "adjust", lang: session.language, var: id, delta, result: null })
      : session.applyManual({ kind: "set", lang: session.language, var: id, value, result: null });
    if (placed) this.moved();
  }

  /** The player adds an entry to a record or takes one out (a clue found, a thread closed). */
  changeRecord(id: string, op: "add" | "remove", entry: string): void {
    const session = this.session, config = this.game?.config;
    if (!session || this.replaying || !config?.records?.some((r) => r.id === id) || entry.trim() === "") return;
    const count = `${id}${inkNames(config).countSuffix}`;
    if (session.applyManual({ kind: "record", lang: session.language, var: id, count, op, entry: entry.trim(), result: null })) this.moved();
  }

  // --- saves ---

  /** Saves the run so far as a run of its own (a snapshot: playing on changes the draft, not it); null when there is nothing to save. */
  async save(name?: string): Promise<SaveInfo | null> {
    const session = this.session, store = this.host.store(), run = this.run;
    if (!session || !store || !run || this.root === null || this.replaying || session.save() === null) {
      this.host.notify(T().nothingToSave);
      return null;
    }
    const now = this.host.now().toISOString();
    const { conflictOf: _conflictOf, ...current } = withTaken(run, session.taken, session.seqNext, now, session.asides);
    const id = this.newId(now);
    const snapshot: Run = { ...current, id, draft: false, name: name?.trim() || T().saveName(this.saves.length + 1), createdAt: now, rev: 0, baseRev: 0 };
    try {
      await store.write(snapshot);
    } catch (e) {
      this.writeFailed(e);
      return null;
    }
    await this.refreshSaves();
    this.host.notify(T().saved + snapshot.name);
    return { id, name: snapshot.name, savedAt: now };
  }

  /** Loads a saved run into the draft (the save itself stays as it was) and replays it. */
  async load(id: string): Promise<void> {
    const store = this.host.store(), root = this.root;
    if (!store || root === null || this.replaying) return;
    const saved = await store.read(root, id);
    if (!saved) return;
    const { conflictOf: _conflictOf, ...rest } = saved;
    this.run = { ...rest, id: "draft", draft: true, name: "", story: root, rev: this.run?.rev ?? 0, baseRev: 0, updatedAt: this.host.now().toISOString() };
    this.stopped = null;
    // Loading is the player's doing: the draft is now the save's run (not what the session played before).
    this.writeRun();
    this.playRun();
  }

  async remove(id: string): Promise<void> {
    const store = this.host.store();
    if (this.root === null || !store) return;
    await store.remove(this.root, id);
    await this.refreshSaves();
  }

  /** Every run of the story, saves and the draft. */
  async runs(): Promise<Run[]> {
    const store = this.host.store();
    return this.root === null || !store ? [] : store.list(this.root);
  }

  /** The run so far, whole (the steps a stop left pending included), to export; null when there is none. */
  whole(): Run | null {
    const session = this.session, run = this.run;
    if (!session || !run || this.root === null) return null;
    const { pending: _pending, ...whole } = withTaken(run, session.taken, session.seqNext, this.host.now().toISOString(), session.asides);
    return whole;
  }

  /** Keeps a run read from elsewhere (an exported file) as a save of this story, named `fallback` when it has no name. */
  async import(run: Run, fallback: string): Promise<{ id: string; name: string } | null> {
    const store = this.host.store(), root = this.root;
    if (!store || root === null) return null;
    const now = this.host.now().toISOString();
    const { pending: _pending, conflictOf: _conflictOf, ...rest } = run;
    const saved: Run = { ...rest, id: this.newId(now), story: root, draft: false, name: run.name || fallback, updatedAt: now, rev: 0, baseRev: 0 };
    await store.write(saved);
    await this.refreshSaves();
    return { id: saved.id, name: saved.name };
  }

  /** Reads the saved runs of the current story for the saves list. */
  async refreshSaves(): Promise<void> {
    const root = this.root, store = this.host.store();
    if (root === null || !store) {
      this.saves = [];
      return;
    }
    try {
      const runs = await store.list(root);
      if (this.root !== root) return;
      this.saves = runs.filter((r) => !r.draft).map((r) => ({
        id: r.id,
        name: r.conflictOf !== undefined ? T().conflictCopy(r.name || T().draftName) : r.name,
        savedAt: r.updatedAt,
      }));
    } catch (e) {
      console.error("Inkwright: could not list saved runs", e);
    }
    this.host.changed();
  }

  // --- stops ---

  /** Hides the note that the panel stopped short; the steps not replayed stay until the player does something new. */
  dismissStop(): void {
    this.stopped = null;
    this.host.changed();
  }

  dismissNote(): void {
    this.note = null;
    this.host.changed();
  }

  /** "Go on by index": the steps a replay could not take are taken by their index, whatever is there now. */
  async continueByIndex(): Promise<void> {
    const session = this.session, run = this.run;
    if (!session || !run?.pending?.length || this.replaying) return;
    const pending = run.pending;
    const actions = replayActions({ ...run, actions: pending });
    this.replaying = { done: 0, total: actions.length };
    this.host.changed();
    const result = await session.replay(actions, { mode: "index", wait: () => this.host.wait() });
    if (this.session !== session) return;
    this.replaying = null;
    // The player asked for it: written like a choice (the whole run is saved first, as on any move past a stop).
    this.persist();
    const left = pending.slice(result.done);
    if (left.length > 0 && this.run) {
      this.run = { ...this.run, pending: left };
      this.stopped = { reason: result.stop?.reason ?? "mismatch", step: session.taken.length + 1, pending: left.length };
    }
    this.apply(result.step);
  }

  /** "Back to before the edit": plays the run on the version it was last played on, until the newest is applied. */
  async useOlder(): Promise<void> {
    const run = this.run, store = this.host.store(), root = this.root;
    if (!run?.build || !store || root === null || this.replaying) return;
    const build = await store.readBuild(root, run.build);
    if (!build) return;
    let story: Story;
    try {
      story = new Story(build.storyJson);
    } catch (e) {
      this.writeFailed(e);
      return;
    }
    const config = build.config as GameConfig | null;
    this.frozen = { story: root, hash: build.hash, createdAt: build.createdAt };
    this.storedBuilds.add(build.hash);
    // The run's pending steps are its own again: it is replayed whole on the version it was played on.
    const { pending: _pending, ...whole } = run;
    this.run = whole;
    this.useVersion({ story, engine: config ? new GameEngine(config, { keepRolls: Infinity }) : null, hash: build.hash });
    this.playRun();
  }

  /** Leaves the older version (or a waiting update) for the newest compile, which may stop the run again where the edit is. */
  useNewest(): void {
    if (!this.newest || this.replaying) return;
    this.update = false;
    this.frozen = null;
    this.useVersion(this.newest);
    this.playRun();
  }

  /** Stops the run at the step whose outcome changed: the rest is pending, as at any stop. */
  stopAtDrift(): void {
    const session = this.session, run = this.run, at = this.note?.driftAt;
    if (!session || !run || at === null || at === undefined || this.replaying) return;
    const drifting = run.actions[at];
    if (!drifting) return;
    // Everything done from the drifting action on is taken back (choices and tray asides alike) and kept as pending.
    session.undoUntil(drifting.seq);
    const left = run.actions.slice(at);
    this.run = { ...run, pending: left };
    this.note = null;
    this.stopped = { reason: "chosen", step: stepAt(run.actions, at), pending: left.length };
    this.apply(session.current());
  }

  /** A choice made, its text carrying the name of the card it was played with or the line typed. */
  withCard(c: Chosen): { text: string; at: number } {
    const p = c.payload;
    const extra = !p ? null : "item" in p ? (this.game ? this.game.cardName(p.item) : null)
      : "items" in p ? p.items.map((i) => this.game?.cardName(i) ?? i).join(" + ") : p.text;
    return { text: extra ? `${c.text} · ${extra}` : c.text, at: c.at };
  }

  // --- inside ---

  private apply(step: Step): void {
    this.last = step;
    this.host.changed();
  }

  /** A move the session already made (an aside, a change by hand): shown and written. */
  private moved(): void {
    if (!this.session) return;
    this.apply(this.session.current());
    this.persist();
  }

  private writeFailed(e: unknown): void {
    this.host.notify(T().runWriteFailed(e instanceof Error ? e.message : String(e)));
  }

  /** A new run id. */
  private newId(now: string): string {
    return newRun({ story: this.root ?? "", name: "", draft: false, startPoint: null, character: null, device: "", now }).id;
  }

  /** The dice tray's dice for its next use: the run's own seed and how many times the tray was used (so back, then the same question, gets the same answer). */
  private trayDice(): Rng | null {
    const session = this.session, run = this.run;
    if (!session || !run || this.replaying) return null;
    return seededDice(run.seeds.oracle, session.asides.filter((a) => a.kind === "oracle" || a.kind === "roll").length);
  }

  /** Plays this version of the story from now on. */
  private useVersion(v: StoryVersion): void {
    this.compiled = v.story;
    this.game = v.engine;
    this.buildHash = v.hash;
  }

  /** The story's draft run as saved, or a new one (not written until the player does something). */
  private async readDraft(root: string): Promise<Run> {
    try {
      const saved = await this.host.store()?.read(root, "draft");
      if (saved) return saved;
    } catch (e) {
      console.error("Inkwright: could not read the saved run", e);
    }
    return newRun({ story: root, name: "", draft: true, startPoint: null, character: null, device: "", now: this.host.now().toISOString() });
  }

  /** Replaces the draft with a new one (new seeds) from the current start point and character; written by the next persist. */
  private freshDraft(): void {
    const store = this.host.store();
    if (this.root === null || !store) return;
    // Player mode: starting over is a new run; the one so far stays in the saves list.
    const session = this.session;
    if (this.host.playerMode() && this.run && session && session.taken.length > 0) {
      const now = this.host.now();
      // Stopped short of where it had got to: keep the whole run (its actions still hold the steps not replayed).
      const source = this.run.pending?.length ? { ...this.run, updatedAt: now.toISOString() } : withTaken(this.run, session.taken, session.seqNext, now.toISOString(), session.asides);
      const { conflictOf: _conflictOf, pending: _pending, ...kept } = source;
      const old: Run = { ...kept, id: this.newId(now.toISOString()), draft: false, name: T().runName(stamp(now)), rev: 0, baseRev: 0 };
      this.enqueue(async () => {
        await store.write(old).catch((e: unknown) => this.writeFailed(e));
        await this.refreshSaves();
      });
    }
    const fresh = newRun({ story: this.root, name: "", draft: true, startPoint: this.startPoint, character: this.character, device: "", now: this.host.now().toISOString() });
    // The revision carries on, so this write supersedes every copy of the old draft.
    this.run = { ...fresh, rev: this.run?.rev ?? 0 };
    this.stopped = null;
  }

  /**
   * Writes the run as the session has it now. Called after each thing the player does, and only then:
   * a replay, a stop or a new version never writes, so they cannot overwrite a run with less than it had.
   */
  private persist(): void {
    const session = this.session, store = this.host.store(), run = this.run;
    if (!session || !store || !run || this.replaying) return;
    this.stopped = null;
    this.recap = null;
    const now = this.host.now();
    // Moving on from where a replay stopped drops the steps it could not take: keep the whole run as a save first.
    if (run.pending && run.pending.length > 0 && !this.backedUp) {
      this.backedUp = true;
      const { pending: _pending, conflictOf: _conflictOf, ...whole } = run;
      const backup: Run = { ...whole, id: this.newId(now.toISOString()), draft: false, name: T().backupName(stamp(now)), createdAt: now.toISOString(), rev: 0, baseRev: 0 };
      this.enqueue(async () => {
        await store.write(backup).catch((e: unknown) => this.writeFailed(e));
        await this.refreshSaves();
      });
    }
    this.run = { ...withTaken(run, session.taken, session.seqNext, now.toISOString(), session.asides), ...(this.buildHash ? { build: this.buildHash } : {}) };
    this.keepBuild();
    this.host.afterMove?.();
    this.writeRun();
  }

  /** The version being played is kept (once), so a later edit can go back to it. */
  private keepBuild(): void {
    const store = this.host.store(), root = this.root, story = this.compiled, hash = this.buildHash;
    if (!store || root === null || !story || !hash || this.storedBuilds.has(hash)) return;
    this.storedBuilds.add(hash);
    const config = this.game?.config ?? null;
    const createdAt = this.host.now().toISOString();
    this.enqueue(() =>
      store.writeBuild(root, { hash, storyJson: story.ToJson() as string, config, createdAt }).catch((e: unknown) => {
        this.storedBuilds.delete(hash);
        console.error("Inkwright: could not keep this version of the story", e);
      }));
  }

  /** Queues a write of the run as it is now (writes happen one after another, each of the latest run). */
  private writeRun(): void {
    const store = this.host.store();
    if (!store || this.writeQueued) return;
    this.writeQueued = true;
    this.enqueue(async () => {
      this.writeQueued = false;
      const current = this.run;
      if (!current) return;
      try {
        const written = await store.write(current);
        if (this.run && this.run.id === written.id && this.run.story === written.story) this.run = { ...this.run, rev: written.rev, baseRev: written.baseRev, device: written.device };
      } catch (e) {
        this.writeFailed(e);
      }
    });
  }

  /**
   * Plays the run on the compiled story: a fresh session seeded from the run, started where the run
   * starts, then the run's actions replayed (asynchronously). A start point or character the story no
   * longer has stops it before anything is replayed; the run is left as it was either way.
   */
  private playRun(): void {
    const story = this.compiled, run = this.run;
    if (!story || !run) return;
    this.replayAbort?.abort();
    this.replaying = null;
    this.stopped = null;
    this.note = null;
    this.backedUp = false;
    // Whether this play picks the run up from the folder: taken now, so no later replay shows a stale recap.
    const resuming = this.resuming;
    this.resuming = false;
    this.recap = null;
    const game = this.game;
    let problem: Stopped | null = null;
    if (run.startPoint !== null && !this.flows.some((f) => f.path === run.startPoint)) {
      problem = { reason: "start", step: 1, pending: run.actions.length, detail: run.startPoint };
    } else if (game && run.character !== null && !playableCharacters(game.config).some((c) => c.id === run.character)) {
      problem = { reason: "character", step: 1, pending: run.actions.length, detail: run.character };
    }
    this.startPoint = problem?.reason === "start" ? null : run.startPoint;
    this.character = problem?.reason === "character" ? null : run.character;
    const session = new PlaySession(story, {
      language: this.host.storyLanguage() ?? undefined,
      setup: game ? (s) => game.setup(s, this.character ?? undefined) : undefined,
      // The run's seeds, so its RANDOMs, shuffles and dice come out as they did.
      prepare: (s) => {
        const seeds = this.run?.seeds ?? run.seeds;
        s.state.storySeed = seeds.story;
        s.state.previousRandom = 0;
        game?.seed(s, seeds.dice);
      },
      outcome: game ? () => game.signatures() : undefined,
      // A value changed by hand stays within its resource's range.
      clampVar: (name, value) => {
        const r = game?.config.resources.find((x) => x.id === name);
        return r ? Math.min(r.max, Math.max(r.min, value)) : value;
      },
    });
    session.seqNext = run.seqNext;
    this.session = session;
    if (problem) {
      this.run = { ...run, pending: run.actions };
      this.stopped = problem;
      this.apply(session.startAt(this.startPoint));
      void this.offerOlder(problem);
      return;
    }
    const legacy = run.legacy;
    const step = legacy?.from === "save"
      ? session.load({ state: legacy.state, log: legacy.log, startPoint: run.startPoint })
      : legacy?.from === "start" ? session.startFrom(legacy.state) : session.startAt(run.startPoint);
    this.apply(step);
    const actions = replayActions(run);
    if (actions.length > 0) void this.replayRun(session, run, actions, resuming);
  }

  /** Replays a run's actions on the session, drawing progress; stops short (and says so) when the story no longer fits. */
  private async replayRun(session: PlaySession, run: Run, actions: ReplayAction[], resuming: boolean): Promise<void> {
    const abort = new AbortController();
    this.replayAbort = abort;
    this.replaying = { done: 0, total: actions.length };
    this.host.changed();
    let drawn = Date.now();
    const result = await session.replay(actions, {
      mode: "match",
      signal: abort.signal,
      budgetMs: this.host.replayBudget,
      wait: () => this.host.wait(),
      onProgress: (done, total) => {
        this.replaying = { done, total };
        if (Date.now() - drawn > 250) {
          drawn = Date.now();
          this.host.changed();
        }
      },
    });
    // A newer version, a load or a restart took over.
    if (abort.signal.aborted || this.session !== session) return;
    this.replayAbort = null;
    this.replaying = null;
    const left = run.actions.slice(result.done);
    if (left.length > 0) {
      // The rest of the run is kept: written again only when the player does something new here.
      this.run = { ...(this.run ?? run), pending: left };
      this.stopped = { reason: result.stop?.reason ?? "mismatch", step: stepAt(run.actions, result.done), pending: left.length };
      void this.offerOlder(this.stopped);
    }
    // The drift is kept as the action's position (to stop there) and shown as the player's step (choices only).
    if (result.guesses.length > 0 || result.skipped.length > 0 || result.drift !== null) {
      this.note = { guesses: result.guesses.length, skipped: result.skipped.length, drift: result.drift === null ? null : stepAt(run.actions, result.drift), driftAt: result.drift };
    }
    // Picked up after more than an hour: a line where the player left off.
    if (resuming && this.host.now().getTime() - Date.parse(run.updatedAt) > 60 * 60 * 1000) this.recap = { at: session.log.length, when: stamp(new Date(run.updatedAt)) };
    this.apply(result.step);
  }

  /** A stop can go back to the version the run was last played on, when that version is kept and is not this one. */
  private async offerOlder(stop: Stopped): Promise<void> {
    const run = this.run, store = this.host.store();
    if (!run?.build || !store || run.build === this.buildHash) return;
    if (!(await store.hasBuild(run.story, run.build))) return;
    if (this.stopped === stop) {
      this.stopped = { ...stop, older: true };
      this.host.changed();
    }
  }
}

/** `2026-11-04 10:05`, local time. */
export function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
