import { FuzzySuggestModal, Notice, Platform, Plugin, TFile, TFolder, arrayBufferToBase64, moment, normalizePath, parseYaml, type App, type WorkspaceLeaf } from "obsidian";
import { InkwrightApi } from "./api";
import { compileStory, type Flow } from "./compile/compile";
import type { StoryGraph } from "./compile/graph";
import { GRAPH_VIEW_TYPE, GraphView, type GraphController } from "./views/GraphView";
import type { Diagnostic } from "./compile/diagnostics";
import { inputOf, inputPayload } from "./play/input";
import { PlaySession, findLanguageVar, type Chosen, type Payload, type ReplayAction, type SaveData, type Step } from "./play/session";
import { hash, migrateSave, newRun, parseRun, replayActions, stepAt, withTaken, type Run } from "./play/run";
import { askOracle, oracleRules, rollTray, type Odds } from "./play/oracle";
import { seededDice, type Rng } from "./game/dice";
import { RunStore, type Files, type SyncMode } from "./play/store";
import { Story } from "inkjs/full";
import { LatestOnly, applyVaultEvent, isDependency, nextRoot } from "./root";
import { getLanguage, resolveLanguage, setLanguage, T, type LanguageSetting } from "./i18n";
import INK_RUNTIME from "virtual:ink-runtime";
import GAME_ENGINE from "virtual:game-engine";
import { buildWebPage, exportFileName, storyTitle } from "./export/web";
import { GameEngine } from "./game/engine";
import { findGameNote, loadGameConfig } from "./game/obsidian";
import { engineFile, localize, playableCharacters, type ConfigProblem, type GameConfig } from "./game/config";
import { generateInk } from "./game/inkgen";
import { resolveConfig, type ConfigSource } from "./game/resolve";
import type { CardNote } from "./game/cards";
import { renderJournal } from "./play/journal";
import { InkwrightSettingTab } from "./views/SettingTab";
import { INK_VIEW_TYPE, InkView } from "./views/InkView";
import { PLAY_VIEW_TYPE, PlayView, type GameView, type PlayController, type PlayState } from "./views/PlayView";

export interface SaveSlot extends SaveData {
  id: string;
  name: string;
  savedAt: string;
}

interface Settings {
  locked: string | null;
  language: LanguageSetting;
  /** Saves per main story path. */
  saves: Record<string, SaveSlot[]>;
  /** Language bilingual stories are played in; null: each story's own default. */
  storyLanguage: string | null;
  /** Keep the play panel's top bar in view while the text scrolls. */
  pinBar?: boolean;
  /** Vault folder runs are saved in (set on first use from the UI language). */
  saveFolder?: string;
  /** How the vault is synced: how run conflicts are handled. */
  syncMode?: SyncMode;
  /** Ids of old saves (in `saves`) already moved into the run folder. */
  migrated?: string[];
  /** Player mode: author controls hidden, the main story locked, edits wait until applied, restart keeps the run. */
  playerMode?: boolean;
}

/** A compiled story with the engine for its game note, and a hash of both: one version of a story. */
interface StoryVersion {
  story: Story;
  engine: GameEngine | null;
  hash: string;
}

/** A saved run as the panel and the API list it. */
interface SaveInfo {
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

/** What readGameNote found: the note, its config (null when unusable), the warnings to show, and the other notes it reads (tables). */
interface GameNoteRead {
  note: TFile;
  config: GameConfig | null;
  warnings: string[];
  files: string[];
}

export default class InkwrightPlugin extends Plugin implements PlayController, GraphController {
  private config: Settings = { locked: null, language: "auto", saves: {}, storyLanguage: null };
  private latest = new LatestOnly();
  private timer: number | null = null;
  private files: string[] = [];
  private diagnostics: Diagnostic[] = [];
  private root: string | null = null;
  private session: PlaySession | null = null;
  private last: Step | null = null;
  private flows: Flow[] = [];
  private startPoint: string | null = null;
  private graph: StoryGraph | null = null;
  private graphStale = false;
  /** Rules engine when the main story's folder has a game note; null for plain stories. */
  private game: GameEngine | null = null;
  /** Chosen playable character; null = the game's first. */
  private character: string | null = null;
  /** Where runs are saved; null until loaded. */
  private store: RunStore | null = null;
  /** The run being played: the story's draft (see docs/solo-prd.md §4.0–4.1). */
  private run: Run | null = null;
  /** The compiled story the session plays, so a run can be restarted or loaded without compiling again. */
  private compiled: Story | null = null;
  private replayAbort: AbortController | null = null;
  /** Progress of a replay under way; null when none is. While it runs, the panel takes no input. */
  private replaying: { done: number; total: number } | null = null;
  private stopped: Stopped | null = null;
  /** Saved runs of the current story (not the draft), for the panel's saves list. */
  private savesCache: SaveInfo[] = [];
  /** Another device changed the run: read it again on the next compile. */
  private runDirty = false;
  /** The latest compiled version of the main story. */
  private newest: StoryVersion | null = null;
  /** An older version the player went back to ("back to before the edit"); recompiles leave it alone until the newest is applied. */
  private frozen: { story: string; hash: string; createdAt: string } | null = null;
  /** The version being played: written with the run, kept as a build when the player plays on it. */
  private buildHash: string | null = null;
  /** Builds known to be kept (this session), so each is written once. */
  private storedBuilds = new Set<string>();
  /** What the last replay noticed without stopping: steps found by a guess, the first step whose outcome changed. */
  private note: { guesses: number; drift: number | null; driftAt: number | null } | null = null;
  /** The whole run was saved before the pending steps are dropped: once per stop. */
  private backedUp = false;
  /** Player mode: a newer version of the story is waiting to be applied. */
  private update = false;
  /** The run was picked up after a while: the paragraph count where the player left off, and when. */
  private recap: { at: number; when: string } | null = null;
  /** The run was just read from the save folder (a story opened, a restart): a replay may show a recap. */
  private resuming = false;
  /** Writes of the run, one after another. */
  private writing: Promise<void> = Promise.resolve();
  /** A write is queued and has not started: it will write the latest run, so another is not needed. */
  private writeQueued = false;
  /** Scriptable API for agents, e.g. via `obsidian eval`. See src/api.ts. */
  readonly api = new InkwrightApi(this);

  async onload(): Promise<void> {
    // Load settings first: the language (and command names below) depend on them.
    this.config = { locked: null, language: "auto", saves: {}, storyLanguage: null, ...((await this.loadData()) as Partial<Settings> | null) };
    // Obsidian sets moment's locale to its interface language.
    setLanguage(resolveLanguage(this.config.language, moment.locale()));
    this.store = this.makeStore();
    this.addSettingTab(new InkwrightSettingTab(this.app, this));

    this.registerView(INK_VIEW_TYPE, (leaf) => new InkView(leaf));
    this.registerView(PLAY_VIEW_TYPE, (leaf) => new PlayView(leaf, this));
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));
    this.registerExtensions(["ink"], INK_VIEW_TYPE);

    this.addRibbonIcon("play", T().openPlay, () => void this.openPlay());
    this.addCommand({ id: "open-play", name: T().openPlay, callback: () => void this.openPlay() });
    this.addCommand({ id: "open-play-main", name: T().openPlayMain, callback: () => void this.openPlay("main") });
    this.addRibbonIcon("git-fork", T().openGraph, () => void this.openGraph());
    this.addCommand({ id: "open-graph", name: T().openGraph, callback: () => void this.openGraph() });
    this.addCommand({ id: "lock-main", name: T().lockCurrent, callback: () => void this.lockCurrent() });
    this.addCommand({ id: "unlock-main", name: T().unlock, callback: () => void this.setLocked(null) });
    this.addCommand({ id: "export-web", name: T().exportWeb, callback: () => void this.exportWeb() });
    this.addCommand({ id: "generate-engine", name: T().generateEngine, callback: () => void this.generateEngine() });
    this.addCommand({ id: "write-journal", name: T().writeJournal, callback: () => void this.writeJournal() });
    this.addCommand({ id: "toggle-player-mode", name: T().togglePlayerMode, callback: () => this.togglePlayerMode() });
    this.addCommand({ id: "export-run", name: T().exportRun, callback: () => void this.exportRun() });
    this.addCommand({ id: "import-run", name: T().importRun, callback: () => this.pickRunToImport() });

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      // Focusing the play panel itself must not restart the story.
      if (leaf?.view instanceof PlayView) return;
      if (this.targetRoot() !== this.root) this.schedule();
    }));
    const touch = (path: string) => {
      // A run file written by another device (synced in): the run may have moved on there.
      if (this.store?.isRunFile(path)) {
        if (!this.store.isOwnFile(path)) void this.runFileChanged();
        return;
      }
      // A note added to or removed from a deck's folder changes the deck: the folder itself is a dependency.
      if (isDependency(path, this.files) || this.files.includes(path.slice(0, path.lastIndexOf("/")))) this.schedule();
    };
    this.registerEvent(this.app.vault.on("modify", (f) => touch(f.path)));
    // The game note is read from the metadata cache, which updates after `modify`: compile again then.
    this.registerEvent(this.app.metadataCache.on("changed", (f) => touch(f.path)));
    this.registerEvent(this.app.vault.on("create", (f) => touch(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => {
      void this.updateLock(applyVaultEvent(this.config.locked, { type: "delete", path: f.path }));
      touch(f.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (f, oldPath) => {
      void this.updateLock(applyVaultEvent(this.config.locked, { type: "rename", path: oldPath, newPath: f.path }));
      // A story's runs go with it.
      if (f instanceof TFile && f.extension === "ink") void this.store?.move(oldPath, f.path);
      touch(oldPath);
    }));

    this.app.workspace.onLayoutReady(() => {
      const locked = this.config.locked;
      if (locked !== null && !(this.app.vault.getAbstractFileByPath(locked) instanceof TFile)) {
        void this.updateLock(null);
      }
      void this.migrateSaves().finally(() => this.schedule());
    });
  }

  /** Another device changed data.json (an older version may still save there): pick the settings up, move old saves over. */
  async onExternalSettingsChange(): Promise<void> {
    this.config = { ...this.config, ...((await this.loadData()) as Partial<Settings> | null) };
    await this.migrateSaves();
    await this.refreshSaves();
  }

  /** The run store for the current settings; the save folder is fixed on first use. */
  private makeStore(): RunStore {
    if (!this.config.saveFolder) {
      this.config.saveFolder = getLanguage() === "en" ? "Inkwright/Saves" : "Inkwright/存档";
      void this.saveData(this.config);
    }
    let device = this.app.loadLocalStorage("inkwright-device") as string | null;
    if (typeof device !== "string" || device === "") {
      device = `${Platform.isMobile ? "mobile" : "desktop"}-${Math.random().toString(36).slice(2, 8)}`;
      this.app.saveLocalStorage("inkwright-device", device);
    }
    // Runs are ordinary vault files: read and written through the Vault API like every other file the plugin touches.
    const vault = this.app.vault;
    const at = (p: string) => vault.getAbstractFileByPath(normalizePath(p));
    const file = (p: string) => {
      const f = at(p);
      if (!(f instanceof TFile)) throw new Error("not a file: " + p);
      return f;
    };
    const files: Files = {
      exists: (p) => Promise.resolve(at(p) !== null),
      read: (p) => vault.read(file(p)),
      write: async (p, d) => {
        const f = at(p);
        if (f instanceof TFile) {
          await vault.modify(f, d);
          return;
        }
        try {
          await vault.create(normalizePath(p), d);
        } catch (e) {
          // The file arrived (a sync) after the index was read: write over it instead.
          const now = at(p);
          if (!(now instanceof TFile)) throw e;
          await vault.modify(now, d);
        }
      },
      mkdir: async (p) => {
        if (!at(p)) await vault.createFolder(normalizePath(p));
      },
      // A deleted save goes where the user's deleted files go (the trash, by default).
      remove: async (p) => {
        const f = at(p);
        if (f) await this.app.fileManager.trashFile(f);
      },
      rmdir: async (p) => {
        const f = at(p);
        if (f) await this.app.fileManager.trashFile(f);
      },
      rename: async (from, to) => {
        const f = at(from);
        if (f) await vault.rename(f, normalizePath(to));
      },
      list: (p) => {
        const f = at(p);
        const children = f instanceof TFolder ? f.children : [];
        return Promise.resolve({
          files: children.filter((c) => c instanceof TFile).map((c) => c.path),
          folders: children.filter((c) => c instanceof TFolder).map((c) => c.path),
        });
      },
    };
    return new RunStore(files, { folder: normalizePath(this.config.saveFolder), device, sync: this.config.syncMode ?? "icloud" });
  }

  /** Moves old saves (kept in data.json) into the run folder; runs again harmlessly. The old data stays for now. */
  private async migrateSaves(): Promise<void> {
    const store = this.store;
    if (!store) return;
    const migrated = new Set(this.config.migrated ?? []);
    let moved = false;
    for (const [story, slots] of Object.entries(this.config.saves)) {
      for (const slot of slots) {
        if (migrated.has(slot.id)) continue;
        const run = migrateSave(slot, story, "");
        try {
          if (!(await store.read(story, run.id))) await store.write(run);
          migrated.add(slot.id);
          moved = true;
        } catch (e) {
          console.error("Inkwright: could not move an old save", e);
        }
      }
    }
    if (moved) {
      this.config.migrated = [...migrated];
      await this.saveData(this.config);
    }
  }

  /** A run file changed on another device: replay when the run there is not the one here. */
  private async runFileChanged(): Promise<void> {
    const root = this.root, store = this.store;
    if (root === null || !store) return;
    // A local write still queued would make the disk look older than the run here: let it land first.
    await this.writing;
    await this.refreshSaves();
    const there = await store.read(root, "draft");
    const here = this.run;
    if (!there || !here || there.story !== root) return;
    const same = (r: Run) => JSON.stringify([r.actions, r.startPoint, r.character, r.seeds, r.legacy ?? null]);
    if (same(there) === same(here)) {
      // Nothing to replay; just remember the newer revision so the next write is based on it.
      if (there.rev > here.rev) this.run = { ...here, rev: there.rev };
      return;
    }
    this.runDirty = true;
    this.schedule();
  }

  onunload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.folderTimer !== null) window.clearTimeout(this.folderTimer);
  }

  // --- PlayController ---

  startAt(path: string | null): void {
    this.startPoint = path;
    if (!this.session || this.replaying) return;
    this.freshDraft();
    this.apply(this.session.startAt(path));
    this.persist();
  }

  /** In the author's working run, "restart" starts the draft over (new seeds), from the same start point and character. */
  restart(): void {
    if (!this.session || this.replaying) return;
    this.freshDraft();
    this.apply(this.session.startAt(this.startPoint));
    this.persist();
  }

  /** Replaces the draft with a new one (new seeds) from the current start point and character; written by the next persist. */
  private freshDraft(): void {
    if (this.root === null || !this.store) return;
    // Player mode: starting over is a new run; the one so far stays in the saves list.
    const session = this.session;
    if (this.config.playerMode && this.run && session && session.taken.length > 0) {
      const now = new Date();
      // Stopped short of where it had got to: keep the whole run (its actions still hold the steps not replayed).
      const source = this.run.pending?.length ? { ...this.run, updatedAt: now.toISOString() } : withTaken(this.run, session.taken, session.seqNext, now.toISOString(), session.asides);
      const { conflictOf: _conflictOf, pending: _pending, ...kept } = source;
      const id = newRun({ story: this.root, name: "", draft: false, startPoint: null, character: null, device: "", now: now.toISOString() }).id;
      const store = this.store;
      const old: Run = { ...kept, id, draft: false, name: T().runName(stamp(now)), rev: 0, baseRev: 0 };
      this.writing = this.writing.then(async () => {
        await store.write(old).catch((e: unknown) => new Notice(T().runWriteFailed(e instanceof Error ? e.message : String(e))));
        await this.refreshSaves();
      });
    }
    const fresh = newRun({ story: this.root, name: "", draft: true, startPoint: this.startPoint, character: this.character, device: "", now: new Date().toISOString() });
    // The revision carries on, so this write supersedes every copy of the old draft.
    this.run = { ...fresh, rev: this.run?.rev ?? 0 };
    this.stopped = null;
  }

  choose(index: number, value?: string): void {
    if (!this.session || this.replaying) return;
    // A choice that needs an item not carried is shown locked; it cannot be taken.
    const choice = this.last?.choices.find((c) => c.index === index);
    if (choice && this.game && !this.game.canChoose(choice)) return;
    // A #play choice is taken with a card from its hand: the engine writes it into the played VAR first.
    let payload: Payload | undefined;
    const play = choice && this.game ? this.game.playOf(choice) : null;
    if (play && this.game) {
      const p = value === undefined ? null : this.game.playPayload(play.hand, value);
      if (!p) return;
      payload = p;
    } else {
      // An #input choice is taken with the line typed: it is written into its VAR first.
      const variable = choice ? inputOf(choice) : null;
      if (variable !== null) {
        const p = inputPayload(variable, value ?? "");
        if (!p) return;
        payload = p;
      }
    }
    this.apply(this.session.choose(index, payload));
    this.persist();
  }

  /** A choice made, its text carrying the name of the card it was played with or the line typed. */
  private withCard(c: Chosen): { text: string; at: number } {
    const p = c.payload;
    const extra = !p ? null : "item" in p ? (this.game ? this.game.cardName(p.item) : null) : p.text;
    return { text: extra ? `${c.text} · ${extra}` : c.text, at: c.at };
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

  setStoryLanguage(lang: string): void {
    if (this.replaying) return;
    this.config.storyLanguage = lang;
    void this.saveData(this.config);
    if (!this.session) return;
    // The record of the run is rewritten in the new language as the run replays in it.
    this.apply(this.session.setLanguage(lang));
    this.persist();
  }

  /** Saves the run so far as a run of its own (a snapshot: playing on changes the draft, not it); null when there is nothing to save. */
  async saveGame(name?: string): Promise<SaveInfo | null> {
    const session = this.session, store = this.store, run = this.run;
    if (!session || !store || !run || this.root === null || this.replaying || session.save() === null) {
      new Notice(T().nothingToSave);
      return null;
    }
    const now = new Date().toISOString();
    const { conflictOf: _conflictOf, ...current } = withTaken(run, session.taken, session.seqNext, now, session.asides);
    const id = newRun({ story: this.root, name: "", draft: false, startPoint: null, character: null, device: "", now }).id;
    const snapshot: Run = { ...current, id, draft: false, name: name?.trim() || T().saveName(this.savesCache.length + 1), createdAt: now, rev: 0, baseRev: 0 };
    try {
      await store.write(snapshot);
    } catch (e) {
      new Notice(T().runWriteFailed(e instanceof Error ? e.message : String(e)));
      return null;
    }
    await this.refreshSaves();
    new Notice(T().saved + snapshot.name);
    return { id, name: snapshot.name, savedAt: now };
  }

  /** Loads a saved run into the draft (the save itself stays as it was) and replays it. */
  loadGame(id: string): void {
    void this.loadRun(id);
  }

  private async loadRun(id: string): Promise<void> {
    const store = this.store, root = this.root;
    if (!store || root === null || this.replaying) return;
    const saved = await store.read(root, id);
    if (!saved) return;
    const { conflictOf: _conflictOf, ...rest } = saved;
    this.run = { ...rest, id: "draft", draft: true, name: "", story: root, rev: this.run?.rev ?? 0, baseRev: 0, updatedAt: new Date().toISOString() };
    this.stopped = null;
    // Loading is the player's doing: the draft is now the save's run (not what the session played before).
    this.writeRun();
    this.playRun();
  }

  async deleteSave(id: string): Promise<void> {
    if (this.root === null || !this.store) return;
    await this.store.remove(this.root, id);
    await this.refreshSaves();
  }

  savesForRoot(): SaveInfo[] {
    return this.savesCache;
  }

  currentRun(): Run | null {
    return this.run;
  }

  async runsForRoot(): Promise<Run[]> {
    return this.root === null || !this.store ? [] : this.store.list(this.root);
  }

  /** The dice tray's dice for its next use: the run's own seed and how many times the tray was used (so back, then the same question, gets the same answer). */
  private trayDice(): Rng | null {
    const session = this.session, run = this.run;
    if (!session || !run || this.replaying) return null;
    return seededDice(run.seeds.oracle, session.asides.length);
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
    this.apply(session.current());
    this.persist();
  }

  /** Rolls a formula on the tray (as `roll()` reads it), or one of the game's tables marked for it. */
  rollTray(formula: string, table?: string): void {
    const session = this.session, rng = this.trayDice();
    if (!session || !rng) return;
    const def = table === undefined ? undefined : this.game?.config.tables?.find((t) => t.id === table);
    if (table !== undefined && !def) return;
    const result = rollTray(formula, def ? { table: def, language: session.language ?? getLanguage() } : undefined, rng);
    if (!result) {
      new Notice(T().badFormulaNamed(formula));
      return;
    }
    session.addAside({ kind: "roll", lang: session.language, formula: result.formula, ...(def ? { table: def.id } : {}), result });
    this.apply(session.current());
    this.persist();
  }

  /** The player changes a resource by hand (one marked `manual`): by `delta`, or to `value`. Kept in the run; shows from the next choice on. */
  adjustResource(id: string, delta: number, value?: number): void {
    const session = this.session;
    if (!session || this.replaying) return;
    const def = this.game?.config.resources.find((r) => r.id === id);
    if (!def?.manual) return;
    const placed = value === undefined
      ? session.applyManual({ kind: "adjust", lang: session.language, var: id, delta, result: null })
      : session.applyManual({ kind: "set", lang: session.language, var: id, value, result: null });
    if (!placed) return;
    this.apply(session.current());
    this.persist();
  }

  /** Player mode on or off; turning it on locks the main story (so opening a chapter does not switch away from it). */
  togglePlayerMode(): void {
    this.config.playerMode = !(this.config.playerMode ?? false);
    void this.saveData(this.config);
    if (this.config.playerMode && this.config.locked === null && this.root !== null) void this.updateLock(this.root);
    // Leaving player mode: a waiting update is applied, as edits are in author mode.
    if (!this.config.playerMode && this.update) this.useNewest();
    this.pushState();
  }

  /** Writes the run so far as a file (a backup, or to move it elsewhere): <save folder>/_exports/<story> <time>.json. */
  async exportRun(): Promise<{ path: string | null }> {
    const session = this.session, run = this.run, root = this.root;
    if (!session || !run || root === null) {
      new Notice(T().nothingToSave);
      return { path: null };
    }
    const now = new Date();
    const { pending: _pending, ...whole } = withTaken(run, session.taken, session.seqNext, now.toISOString(), session.asides);
    // One fixed name whatever the UI language, so exports do not end up in two folders.
    const folder = normalizePath(`${this.config.saveFolder ?? "Inkwright"}/_exports`);
    // Named like the story's save folder: its file name, or its folder's for a main.ink.
    const parts = root.replace(/\.ink$/, "").split("/");
    const name = (parts.at(-1) === "main" && parts.length > 1 ? parts[parts.length - 2] : parts.at(-1) ?? "story").replace(/[\\/:*?"<>|]/g, "-");
    let path = normalizePath(`${folder}/${name} ${stamp(now).replace(":", "-")}.json`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = path.replace(/( \(\d+\))?\.json$/, ` (${n}).json`);
    let made = "";
    for (const part of folder.split("/")) {
      made = made === "" ? part : `${made}/${part}`;
      if (!this.app.vault.getAbstractFileByPath(made)) await this.app.vault.createFolder(made);
    }
    await this.app.vault.create(path, JSON.stringify(whole, null, 1));
    new Notice(T().runExported(path));
    return { path };
  }

  /** Imports an exported run (a .json file in the vault) as a save of the current story. */
  async importRun(path: string): Promise<{ id: string; name: string } | null> {
    const store = this.store, root = this.root;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!store || root === null || !(file instanceof TFile)) return null;
    // The file may come from anywhere: only a run a replay can take is imported.
    const run = parseRun(await this.app.vault.read(file));
    if (!run) {
      new Notice(T().notARun(path));
      return null;
    }
    const now = new Date().toISOString();
    const { pending: _pending, conflictOf: _conflictOf, ...rest } = run;
    const id = newRun({ story: root, name: "", draft: false, startPoint: null, character: null, device: "", now }).id;
    const saved: Run = { ...rest, id, story: root, draft: false, name: run.name || file.basename, updatedAt: now, rev: 0, baseRev: 0 };
    await store.write(saved);
    await this.refreshSaves();
    new Notice(T().runImported(saved.name));
    return { id, name: saved.name };
  }

  private pickRunToImport(): void {
    const files = this.app.vault.getFiles().filter((f) => f.extension === "json");
    new RunFileModal(this.app, files, (f) => void this.importRun(f.path)).open();
  }

  /** Hides the note that the panel stopped short; the steps not replayed stay until the player does something new. */
  dismissStop(): void {
    this.stopped = null;
    this.pushState();
  }

  /** Reads the saved runs of the current story for the saves list. */
  private async refreshSaves(): Promise<void> {
    const root = this.root, store = this.store;
    if (root === null || !store) {
      this.savesCache = [];
      return;
    }
    try {
      const runs = await store.list(root);
      if (this.root !== root) return;
      this.savesCache = runs.filter((r) => !r.draft).map((r) => ({
        id: r.id,
        name: r.conflictOf !== undefined ? T().conflictCopy(r.name || T().draftName) : r.name,
        savedAt: r.updatedAt,
      }));
    } catch (e) {
      console.error("Inkwright: could not list saved runs", e);
    }
    this.pushState();
  }

  /**
   * Writes the run as the session has it now. Called after each thing the player does, and only then:
   * a replay, a stop or a recompile never writes, so they cannot overwrite a run with less than it had.
   */
  private persist(): void {
    const session = this.session, store = this.store, run = this.run;
    if (!session || !store || !run || this.replaying) return;
    this.stopped = null;
    this.recap = null;
    const now = new Date();
    // Moving on from where a replay stopped drops the steps it could not take: keep the whole run as a save first.
    if (run.pending && run.pending.length > 0 && !this.backedUp) {
      this.backedUp = true;
      const { pending: _pending, conflictOf: _conflictOf, ...whole } = run;
      const id = newRun({ story: run.story, name: "", draft: false, startPoint: null, character: null, device: "", now: now.toISOString() }).id;
      const backup: Run = { ...whole, id, draft: false, name: T().backupName(stamp(now)), createdAt: now.toISOString(), rev: 0, baseRev: 0 };
      this.writing = this.writing.then(async () => {
        await store.write(backup).catch((e: unknown) => new Notice(T().runWriteFailed(e instanceof Error ? e.message : String(e))));
        await this.refreshSaves();
      });
    }
    this.run = { ...withTaken(run, session.taken, session.seqNext, now.toISOString(), session.asides), ...(this.buildHash ? { build: this.buildHash } : {}) };
    this.keepBuild();
    this.writeRun();
  }

  /** The version being played is kept (once), so a later edit can go back to it. */
  private keepBuild(): void {
    const store = this.store, root = this.root, story = this.compiled, hash = this.buildHash;
    if (!store || root === null || !story || !hash || this.storedBuilds.has(hash)) return;
    this.storedBuilds.add(hash);
    const config = this.game?.config ?? null;
    this.writing = this.writing.then(() =>
      store.writeBuild(root, { hash, storyJson: story.ToJson() as string, config, createdAt: new Date().toISOString() }).catch((e: unknown) => {
        this.storedBuilds.delete(hash);
        console.error("Inkwright: could not keep this version of the story", e);
      }));
  }

  /** Queues a write of the run as it is now (writes happen one after another, each of the latest run). */
  private writeRun(): void {
    const store = this.store;
    if (!store || this.writeQueued) return;
    this.writeQueued = true;
    this.writing = this.writing.then(async () => {
      this.writeQueued = false;
      const current = this.run;
      if (!current) return;
      try {
        const written = await store.write(current);
        if (this.run && this.run.id === written.id && this.run.story === written.story) this.run = { ...this.run, rev: written.rev, baseRev: written.baseRev, device: written.device };
      } catch (e) {
        new Notice(T().runWriteFailed(e instanceof Error ? e.message : String(e)));
      }
    });
  }

  toggleLock(): void {
    if (this.config.locked !== null) void this.setLocked(null);
    else void this.lockCurrent();
  }

  togglePin(): void {
    void this.setPinBar(!(this.config.pinBar ?? false));
  }

  getPinBar(): boolean {
    return this.config.pinBar ?? false;
  }

  async setPinBar(value: boolean): Promise<void> {
    this.config.pinBar = value;
    await this.saveData(this.config);
    this.pushState();
  }

  getSaveFolder(): string {
    return this.config.saveFolder ?? "";
  }

  /**
   * A new save folder, applied a moment after the typing stops (the setting reports every keystroke, and each
   * prefix must not become a folder). The run in progress is kept and written to the new folder; the old
   * folder's saves are not moved.
   */
  setSaveFolder(value: string): Promise<void> {
    if (this.folderTimer !== null) window.clearTimeout(this.folderTimer);
    this.folderTimer = window.setTimeout(() => {
      this.folderTimer = null;
      void this.applySaveFolder(value);
    }, 1000);
    return Promise.resolve();
  }

  private folderTimer: number | null = null;

  private async applySaveFolder(value: string): Promise<void> {
    const folder = normalizePath(value.trim());
    if (folder === "" || folder === "/" || folder === this.config.saveFolder) return;
    this.config.saveFolder = folder;
    await this.saveData(this.config);
    await this.writing;
    this.store = this.makeStore();
    if (this.run) this.writeRun();
    await this.refreshSaves();
  }

  getSyncMode(): SyncMode {
    return this.config.syncMode ?? "icloud";
  }

  /** The same folder read another way: every device's copy is still there, so the run in progress stays as it is. */
  async setSyncMode(value: SyncMode): Promise<void> {
    this.config.syncMode = value;
    await this.saveData(this.config);
    await this.writing;
    this.store = this.makeStore();
    await this.refreshSaves();
  }

  async openDiagnostic(d: Diagnostic): Promise<void> {
    await this.openSource(d.file, d.line);
  }

  // --- GraphController ---

  playFrom(path: string): void {
    this.startAt(path);
    void this.openPlay();
  }

  async openSource(path: string, line: number | null): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(T().fileMissing + path);
      return;
    }
    const { workspace } = this.app;
    const leaf =
      workspace.getLeavesOfType(INK_VIEW_TYPE).find((l) => (l.view as InkView).file?.path === path) ??
      workspace.getLeaf("tab");
    await leaf.openFile(file);
    void workspace.revealLeaf(leaf);
    if (line !== null && leaf.view instanceof InkView) leaf.view.goToLine(line);
  }

  // --- settings ---

  getLanguageSetting(): LanguageSetting {
    return this.config.language;
  }

  async setLanguageSetting(value: LanguageSetting): Promise<void> {
    this.config.language = value;
    await this.saveData(this.config);
    setLanguage(resolveLanguage(value, moment.locale()));
    this.pushState();
  }

  /** Writes the story as a standalone web page next to it; defaults to the current main story. */
  async exportWeb(path: string | null = this.targetRoot()): Promise<{ path: string | null; diagnostics: Diagnostic[] }> {
    if (path === null) {
      new Notice(T().noRoot);
      return { path: null, diagnostics: [] };
    }
    const result = await compileStory(path, this.readFile);
    if (!result.story) {
      new Notice(T().exportFailed);
      return { path: null, diagnostics: result.diagnostics };
    }
    const out = exportFileName(path);
    const fallback = out.slice(out.lastIndexOf("/") + 1).replace(/\.html$/, "");
    const game = await this.gameConfigFor(path);
    const html = buildWebPage({
      title: storyTitle(result.story.globalTags, fallback),
      storyJson: result.story.ToJson() as string,
      runtime: INK_RUNTIME,
      id: path,
      languageVar: findLanguageVar(result.story),
      game: game ?? undefined,
      engine: GAME_ENGINE,
      mapImage: game ? await this.dataUri(this.vaultFile(game.map?.image, path)) : undefined,
      cardImages: game ? await this.cardImages(game, path, (f) => this.dataUri(f)) : undefined,
    });
    const existing = this.app.vault.getAbstractFileByPath(out);
    if (existing instanceof TFile) await this.app.vault.modify(existing, html);
    else await this.app.vault.create(out, html);
    new Notice(T().exported + out);
    return { path: out, diagnostics: result.diagnostics };
  }

  async gameConfigFor(path: string): Promise<GameConfig | null> {
    const note = findGameNote(this.app, path);
    const config = note ? loadGameConfig(this.app, note).config : null;
    return config ? (await this.resolveConfig(path, config)).config : null;
  }

  /** The config with its note-kept tables read in; paths in `from` are relative to the story's folder. */
  private resolveConfig(root: string, config: GameConfig): Promise<{ config: GameConfig; problems: ConfigProblem[]; files: string[] }> {
    return resolveConfig(config, this.configSource, root.slice(0, root.lastIndexOf("/") + 1));
  }

  /**
   * What a game note may point at: notes by path, and folders of card notes. A card note is read
   * from the file, frontmatter included (the metadata cache can lag behind a modify event).
   */
  private readonly configSource: ConfigSource = {
    read: (p) => this.readFile(p).catch(() => null),
    notes: async (folder) => {
      const f = this.app.vault.getAbstractFileByPath(normalizePath(folder));
      if (!(f instanceof TFolder)) return null;
      const out: CardNote[] = [];
      for (const child of f.children) {
        if (!(child instanceof TFile) || child.extension !== "md") continue;
        const text = await this.app.vault.read(child);
        const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
        let frontmatter: Record<string, unknown> | undefined;
        try {
          const parsed: unknown = m ? parseYaml(m[1]) : undefined;
          frontmatter = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
        } catch {
          frontmatter = undefined;
        }
        out.push({ path: child.path, name: child.basename, frontmatter, body: m ? text.slice(m[0].length) : text });
      }
      return out;
    },
  };

  /** Card art for the panel, by card id, as resource URLs; set with the engine. */
  private cardArt: Record<string, string> = {};

  private resourceUrl(file: TFile | null): string | null {
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  /** A file the game note names, looked up next to the story first, then as a vault path; null when there is none. */
  private vaultFile(path: string | undefined, storyPath: string): TFile | null {
    if (!path) return null;
    const dir = storyPath.slice(0, storyPath.lastIndexOf("/") + 1);
    for (const p of [normalizePath(dir + path), normalizePath(path)]) {
      const file = this.app.vault.getAbstractFileByPath(p);
      if (file instanceof TFile) return file;
    }
    return null;
  }

  /** A file as a data URI for the exported page; undefined when there is none. */
  private async dataUri(file: TFile | null): Promise<string | undefined> {
    if (!file) return undefined;
    const mime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
    const data = await this.app.vault.readBinary(file);
    return `data:${mime[file.extension.toLowerCase()] ?? "application/octet-stream"};base64,${arrayBufferToBase64(data)}`;
  }

  /** Every card's art, by card id, as the given conversion makes it (a resource URL for the panel, a data URI for the export). */
  private async cardImages(config: GameConfig, storyPath: string, convert: (file: TFile) => Promise<string | undefined>): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const d of config.decks ?? []) {
      for (const c of d.cards) {
        const file = this.vaultFile(c.image, storyPath);
        const url = file ? await convert(file) : undefined;
        if (url) out[c.id] = url;
      }
    }
    return out;
  }

  /**
   * Writes the panel's run so far (text, choices, rolls) as a markdown note. The path comes from the
   * game note's `journal.path` (`{dir}`, `{story}`, `{date}`, `{time}`, `{character}`), default
   * `{dir}日志/{date} {time}.md`; an existing note is never overwritten.
   */
  async writeJournal(): Promise<{ path: string | null }> {
    const session = this.session;
    const root = this.root;
    if (!session || root === null || session.log.length === 0) {
      new Notice(T().nothingToJournal);
      return { path: null };
    }
    const game = this.gameView();
    const now = new Date();
    const dir = root.slice(0, root.lastIndexOf("/") + 1);
    const story = dir === "" ? this.app.vault.getName() : dir.slice(0, -1).split("/").pop() ?? "story";
    const character = game?.characters.find((c) => c.id === game.current)?.name ?? null;
    const language = (session.language ?? getLanguage()) === "en" ? "en" : "zh";
    const text = renderJournal({
      title: story, date: now, language, character, log: session.log, turns: session.turns, choices: session.choicesMade.map((c) => this.withCard(c)),
      rolls: game?.rolls ?? [], voices: game?.voices, skills: game?.skills, asides: session.asides,
    });
    const pad = (n: number) => String(n).padStart(2, "0");
    // A name goes into a file name: no separators, nothing a file system rejects, no "..".
    const clean = (v: string) => Array.from(v).filter((c) => c.charCodeAt(0) >= 32).join("").replace(/[\\/:*?"<>|]/g, "-").replace(/\.{2,}/g, "-").trim();
    const values: Record<string, string> = {
      dir, story: clean(story), character: clean(character ?? ""),
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}-${pad(now.getMinutes())}`,
    };
    const template = this.game?.config.journal?.path ?? "{dir}日志/{date} {time}.md";
    const unknown: string[] = [];
    const filled = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
      if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
      unknown.push(key);
      return "";
    });
    if (unknown.length > 0) new Notice(T().journalUnknownKey(unknown.join(", ")));
    // Stays inside the vault: "." and ".." segments are dropped, the rest normalized the way Obsidian wants it.
    let path = normalizePath(filled.split(/[\\/]/).map((seg) => seg.trim()).filter((seg) => seg !== "" && seg !== "." && seg !== "..").join("/"));
    if (!path.endsWith(".md")) path += ".md";
    const folder = path.slice(0, path.lastIndexOf("/"));
    let made = "";
    for (const part of folder === "" ? [] : folder.split("/")) {
      made = made === "" ? part : `${made}/${part}`;
      if (!this.app.vault.getAbstractFileByPath(made)) await this.app.vault.createFolder(made);
    }
    if (this.app.vault.getAbstractFileByPath(path)) {
      const base = path.slice(0, -3);
      for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${base} (${n}).md`;
    }
    await this.app.vault.create(path, text);
    new Notice(T().journalWritten + path);
    return { path };
  }

  /** Writes the game's engine ink (from its game note) next to the main story; defaults to the current one. */
  async generateEngine(path: string | null = this.targetRoot()): Promise<{ path: string | null; problems: ConfigProblem[] }> {
    if (path === null) {
      new Notice(T().noRoot);
      return { path: null, problems: [] };
    }
    const note = findGameNote(this.app, path);
    if (!note) {
      new Notice(T().noGameNote);
      return { path: null, problems: [] };
    }
    const read = loadGameConfig(this.app, note);
    if (!read.config) {
      new Notice(T().gameConfigUnusable(read.problems.map((p) => T().configProblem(p)).join("; ")));
      return { path: null, problems: read.problems };
    }
    const resolved = await this.resolveConfig(path, read.config);
    const config = resolved.config;
    const problems = [...read.problems, ...resolved.problems];
    const out = path.slice(0, path.lastIndexOf("/") + 1) + engineFile(config);
    const ink = generateInk(config);
    const existing = this.app.vault.getAbstractFileByPath(out);
    if (existing instanceof TFile) await this.app.vault.modify(existing, ink);
    else await this.app.vault.create(out, ink);
    new Notice(T().engineWritten + out);
    return { path: out, problems };
  }

  // --- internals ---

  async openGraph(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(GRAPH_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
    }
    void workspace.revealLeaf(leaf);
    this.schedule();
  }

  /** Opens the player (or shows it where it is); `where` moves it to the main area (a tab: full screen on a phone) or back to the right sidebar. */
  async openPlay(where?: "main" | "side"): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(PLAY_VIEW_TYPE)[0] ?? null;
    if (leaf && where !== undefined && (leaf.getRoot() === workspace.rootSplit) !== (where === "main")) {
      leaf.detach();
      leaf = null;
    }
    if (!leaf) {
      leaf = where === "main" ? workspace.getLeaf("tab") : workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: PLAY_VIEW_TYPE, active: true });
    }
    if (leaf) void workspace.revealLeaf(leaf);
    this.schedule();
  }

  movePlay(view: PlayView): void {
    void this.openPlay(view.leaf.getRoot() === this.app.workspace.rootSplit ? "side" : "main");
  }

  inMainArea(view: PlayView): boolean {
    return view.leaf.getRoot() === this.app.workspace.rootSplit;
  }

  private async lockCurrent(): Promise<void> {
    const f = this.app.workspace.getActiveFile();
    if (!f || f.extension !== "ink") {
      new Notice(T().lockNotInk);
      return;
    }
    await this.setLocked(f.path);
    new Notice(T().locked + f.path);
  }

  private async setLocked(path: string | null): Promise<void> {
    await this.updateLock(path);
    if (path === null) new Notice(T().unlocked);
  }

  private async updateLock(path: string | null): Promise<void> {
    if (path === this.config.locked) return;
    this.config.locked = path;
    await this.saveData(this.config);
    this.schedule();
  }

  private targetRoot(): string | null {
    return nextRoot(this.root, this.app.workspace.getActiveFile()?.path ?? null, this.config.locked);
  }

  private schedule(): void {
    // Nothing to show without a play panel or graph, so skip compiling entirely.
    const { workspace } = this.app;
    if (workspace.getLeavesOfType(PLAY_VIEW_TYPE).length + workspace.getLeavesOfType(GRAPH_VIEW_TYPE).length === 0) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.recompile(), 300);
  }

  readFile = async (path: string): Promise<string> => {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error("not a file: " + path);
    return this.app.vault.cachedRead(f);
  };

  private async recompile(): Promise<void> {
    const root = this.targetRoot();
    if (root !== this.root) {
      this.startPoint = null;
      this.graph = null;
      this.character = null;
    }
    this.root = root;
    if (root === null) {
      this.latest.invalidate();
      this.replayAbort?.abort();
      this.replaying = null;
      this.session = null;
      this.game = null;
      this.diagnostics = [];
      this.files = [];
      this.flows = [];
      this.last = null;
      this.pushState();
      return;
    }
    // Everything that awaits happens inside the guarded run, so a stale run never touches state.
    const latest = await this.latest.run(async () => {
      const result = await compileStory(root, this.readFile);
      const game = await this.readGameNote(root, result.files);
      // The story's run: read when the story changed or another device moved it on; else the one in memory.
      const run = this.run?.story !== root || this.runDirty ? await this.readDraft(root) : null;
      return { result, game, run };
    });
    if (latest === null) return;
    const { result, game } = latest;
    if (latest.run) {
      this.run = latest.run;
      this.runDirty = false;
      this.resuming = true;
      void this.refreshSaves();
    }
    this.files = result.files;
    this.diagnostics = result.diagnostics;
    const engine = this.applyGameNote(game);
    this.flows = result.flows;
    // On a failed compile keep showing the last good graph, marked as stale.
    if (result.graph) this.graph = result.graph;
    this.graphStale = result.graph === null && this.graph !== null;
    if (result.story) {
      this.newest = { story: result.story, engine, hash: hash(`${result.story.ToJson() as string}\n${JSON.stringify(engine?.config ?? null)}`) };
      // Playing an older version on purpose: the edit shows in the diagnostics and the graph, the run is not touched.
      if (this.frozen && this.frozen.story === root) {
        this.pushState();
        return;
      }
      // Player mode: an edit does not interrupt the run; it plays on its version until the update is applied.
      if (this.config.playerMode && !latest.run && this.session && this.compiled && this.buildHash !== null && this.newest.hash !== this.buildHash) {
        this.update = true;
        this.pushState();
        return;
      }
      this.update = false;
      this.frozen = null;
      this.useVersion(this.newest);
      this.playRun();
    } else if (this.frozen && this.frozen.story === root) {
      this.pushState();
    } else {
      this.game = engine;
      this.replayAbort?.abort();
      this.replaying = null;
      this.session = null;
      this.last = null;
      this.pushState();
    }
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
      const saved = await this.store?.read(root, "draft");
      if (saved) return saved;
    } catch (e) {
      console.error("Inkwright: could not read the saved run", e);
    }
    return newRun({ story: root, name: "", draft: true, startPoint: null, character: null, device: "", now: new Date().toISOString() });
  }

  /**
   * Plays the run on the compiled story: a fresh session seeded from the run, started where the run
   * starts, then the run's actions replayed (asynchronously, strictly). A start point or character the
   * story no longer has stops it before anything is replayed; the run is left as it was either way.
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
      language: this.config.storyLanguage ?? undefined,
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
    this.pushState();
    let drawn = Date.now();
    const result = await session.replay(actions, {
      mode: "match",
      signal: abort.signal,
      budgetMs: Platform.isMobile ? 10000 : 5000,
      wait: () => new Promise((resolve) => window.setTimeout(resolve, 0)),
      onProgress: (done, total) => {
        this.replaying = { done, total };
        if (Date.now() - drawn > 250) {
          drawn = Date.now();
          this.pushState();
        }
      },
    });
    // A newer compile, a load or a restart took over.
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
    if (result.guesses.length > 0 || result.drift !== null) {
      this.note = { guesses: result.guesses.length, drift: result.drift === null ? null : stepAt(run.actions, result.drift), driftAt: result.drift };
    }
    // Picked up after more than an hour: a line where the player left off.
    if (resuming && Date.now() - Date.parse(run.updatedAt) > 60 * 60 * 1000) this.recap = { at: session.log.length, when: stamp(new Date(run.updatedAt)) };
    this.apply(result.step);
  }

  /** A stop can go back to the version the run was last played on, when that version is kept and is not this one. */
  private async offerOlder(stop: Stopped): Promise<void> {
    const run = this.run, store = this.store;
    if (!run?.build || !store || run.build === this.buildHash) return;
    if (!(await store.hasBuild(run.story, run.build))) return;
    if (this.stopped === stop) {
      this.stopped = { ...stop, older: true };
      this.pushState();
    }
  }

  /** "Go on by index": the steps a replay could not take are taken by their index, whatever is there now. */
  continueByIndex(): void {
    void this.replayPending("index");
  }

  private async replayPending(mode: "index"): Promise<void> {
    const session = this.session, run = this.run;
    if (!session || !run?.pending?.length || this.replaying) return;
    const pending = run.pending;
    const actions = replayActions({ ...run, actions: pending });
    this.replaying = { done: 0, total: actions.length };
    this.pushState();
    const result = await session.replay(actions, { mode, wait: () => new Promise((resolve) => window.setTimeout(resolve, 0)) });
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
  useOlder(): void {
    void this.playOlder();
  }

  private async playOlder(): Promise<void> {
    const run = this.run, store = this.store, root = this.root;
    if (!run?.build || !store || root === null || this.replaying) return;
    const build = await store.readBuild(root, run.build);
    if (!build) return;
    let story: Story;
    try {
      story = new Story(build.storyJson);
    } catch (e) {
      new Notice(T().runWriteFailed(e instanceof Error ? e.message : String(e)));
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

  /** Leaves the older version for the newest compile (which may stop the run again, where the edit is). */
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

  dismissNote(): void {
    this.note = null;
    this.pushState();
  }

  /**
   * Reads the game note next to the main story (if any) and works out its warnings, including an
   * engine ink file the story lacks or that no longer matches the note. Touches no state, so a
   * recompile may await it; `applyGameNote` installs the outcome.
   */
  private async readGameNote(root: string, included: string[]): Promise<GameNoteRead | null> {
    const note = findGameNote(this.app, root);
    if (!note) return null;
    const read = loadGameConfig(this.app, note);
    const resolved = read.config ? await this.resolveConfig(root, read.config) : null;
    const config = resolved?.config ?? null;
    const message = config ? T().gameConfigProblem : T().gameConfigUnusable;
    const warnings = [...read.problems, ...(resolved?.problems ?? [])].map((p) => message(T().configProblem(p)));
    if (config) {
      const file = engineFile(config);
      const enginePath = root.slice(0, root.lastIndexOf("/") + 1) + file;
      if (!included.includes(enginePath)) warnings.push(T().engineNotIncluded(file));
      else if ((await this.readFile(enginePath).catch(() => null)) !== generateInk(config)) warnings.push(T().engineStale(file));
    }
    // Images drawn by the panel are dependencies too, so a replaced or renamed picture shows up.
    const images = config ? [config.map?.image, ...(config.decks ?? []).flatMap((d) => d.cards.map((c) => c.image))].map((p) => this.vaultFile(p, root)?.path).filter((p): p is string => p !== undefined) : [];
    return { note, config, warnings, files: [...(resolved?.files ?? []), ...images] };
  }

  /** Installs what readGameNote found (dependencies, warnings, card art) and returns the engine for its config; null when there is none. */
  private applyGameNote(read: GameNoteRead | null): GameEngine | null {
    this.cardArt = {};
    if (!read) return null;
    // Edits to the game note, or to a note a table is read from, recompile like edits to any INCLUDEd file.
    for (const path of [read.note.path, ...read.files]) if (!this.files.includes(path)) this.files.push(path);
    for (const text of read.warnings) this.diagnostics.push({ severity: "warning", file: read.note.path, line: null, message: text, raw: "" });
    if (!read.config) return null;
    // Every roll of the run is kept: the dice cards of a long run, and its fingerprints.
    const engine = new GameEngine(read.config, { keepRolls: Infinity });
    if (this.root !== null) {
      for (const d of read.config.decks ?? []) {
        for (const c of d.cards) {
          const url = this.resourceUrl(this.vaultFile(c.image, this.root));
          if (url) this.cardArt[c.id] = url;
        }
      }
    }
    return engine;
  }

  private gameView(): GameView | null {
    const game = this.game;
    if (!game || !this.session) return null;
    const step = this.last;
    // Names follow the story's language when it is bilingual, else the UI's.
    const lang = this.session.language ?? getLanguage();
    game.language = lang;
    return {
      characters: playableCharacters(game.config).map((c) => ({ id: c.id, name: localize(c.name, lang, c.id) })),
      current: game.character(),
      skills: game.config.skills.map((s) => ({ id: s.id, name: localize(s.name, lang, s.id), color: s.voice?.color, stance: localize(s.voice?.stance, lang, "") || undefined })),
      hud: game.hud(),
      checks: (step?.choices ?? []).map((c) => game.describeChoice(c)),
      needs: (step?.choices ?? []).map((c) => game.needsOf(c)),
      plays: (step?.choices ?? []).map((c) => game.playOf(c)),
      map: game.map(step?.choices ?? []),
      dungeon: game.dungeon(),
      mapImage: this.root === null ? null : this.resourceUrl(this.vaultFile(game.config.map?.image, this.root)),
      cardImages: this.cardArt,
      voices: this.session.log.map((p) => game.voiceOf(p)),
      turns: [...this.session.turns],
      rolls: game.rolls,
    };
  }

  private apply(step: Step): void {
    this.last = step;
    this.pushState();
  }

  /** What the play panel shows right now (also returned by the agent API). */
  snapshot(): PlayState {
    const step = this.last;
    return {
      root: this.root,
      locked: this.config.locked,
      diagnostics: this.diagnostics,
      hasStory: this.session !== null,
      log: this.session?.log ?? [],
      choices: step?.choices ?? [],
      ended: step?.ended ?? false,
      runtimeErrors: step?.errors ?? [],
      inspection: this.session?.inspect() ?? null,
      flows: this.flows,
      startPoint: this.startPoint,
      canGoBack: this.session?.canGoBack ?? false,
      chosen: this.session?.lastChoice ? this.withCard(this.session.lastChoice) : null,
      pinned: this.config.pinBar ?? false,
      replay: this.replaying,
      stopped: this.stopped,
      note: this.note,
      playerMode: this.config.playerMode ?? false,
      asides: this.session ? [...this.session.asides] : [],
      trayTables: (this.game?.config.tables ?? []).filter((t) => t.oracle).map((t) => ({ id: t.id, name: localize(t.name, this.session?.language ?? getLanguage(), t.id) })),
      update: this.update,
      recap: this.recap,
      frozen: this.frozen ? { at: stamp(new Date(this.frozen.createdAt)) } : null,
      storyLanguage: this.session?.language ?? null,
      game: this.gameView(),
      saves: this.savesForRoot().map(({ id, name, savedAt }) => ({ id, name, savedAt })),
    };
  }

  /** Recompiles now (skipping the debounce) and resolves when the panel is up to date. */
  async refresh(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    await this.recompile();
  }

  private pushState(): void {
    const state = this.snapshot();
    for (const leaf of this.app.workspace.getLeavesOfType(PLAY_VIEW_TYPE)) {
      if (leaf.view instanceof PlayView) leaf.view.showState(state);
    }
    const visited = new Set((state.inspection?.visits ?? []).map((v) => v.path));
    for (const leaf of this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE)) {
      if (leaf.view instanceof GraphView) {
        leaf.view.showState({ graph: this.graph, stale: this.graphStale, visited, startPoint: this.startPoint });
      }
    }
  }
}

/** `2026-11-04 10:05`, local time. */
function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Picks an exported run file to import. */
class RunFileModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly files: TFile[], private readonly onPick: (f: TFile) => void) {
    super(app);
    this.setPlaceholder(T().pickRunFile);
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(f: TFile): string {
    return f.path;
  }

  onChooseItem(f: TFile): void {
    this.onPick(f);
  }
}
