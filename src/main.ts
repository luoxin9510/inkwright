import { FuzzySuggestModal, Notice, Platform, Plugin, TFile, TFolder, moment, normalizePath, type App, type WorkspaceLeaf } from "obsidian";
import { InkwrightApi } from "./api";
import { compileStory } from "./compile/compile";
import type { StoryGraph } from "./compile/graph";
import { GRAPH_VIEW_TYPE, GraphView, type GraphController } from "./views/GraphView";
import type { Diagnostic } from "./compile/diagnostics";
import { findLanguageVar, type SaveData } from "./play/session";
import { hash, migrateSave, parseRun, type Run } from "./play/run";
import type { Odds } from "./play/oracle";
import { RunController, stamp, type SaveInfo } from "./play/controller";
import { RunStore, type Files, type SyncMode } from "./play/store";
import { LatestOnly, applyVaultEvent, isDependency, nextRoot } from "./root";
import { getLanguage, resolveLanguage, setLanguage, T, type LanguageSetting } from "./i18n";
import INK_RUNTIME from "virtual:ink-runtime";
import GAME_ENGINE from "virtual:game-engine";
import { buildWebPage, exportFileName, storyTitle } from "./export/web";
import { GameEngine } from "./game/engine";
import { GameFiles, findGameNote, loadGameConfig, vaultConfigSource } from "./game/obsidian";
import { folderOf, storyName } from "./paths";
import { engineFile, localize, playableCharacters, type ConfigProblem, type GameConfig } from "./game/config";
import { generateInk } from "./game/inkgen";
import { resolveConfig } from "./game/resolve";
import { liveBlocks, liveHeader, renderJournal } from "./play/journal";
import { JournalNotes } from "./journal-notes";
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
  /** Live journal for stories whose game note does not say (`journal.live`), and for stories without one. */
  liveJournal?: boolean;
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
  private graph: StoryGraph | null = null;
  private graphStale = false;
  /** Where runs are saved; null until loaded. */
  private store: RunStore | null = null;
  /** The story whose live journal path was refused (inside a dependency folder), so it is said only once. */
  private journalRefused: string | null = null;
  /** The run being played: its session, replay, stops and writes. */
  private readonly runs = new RunController({
    store: () => this.store,
    playerMode: () => this.config.playerMode ?? false,
    storyLanguage: () => this.config.storyLanguage,
    notify: (message) => new Notice(message),
    changed: () => this.pushState(),
    now: () => new Date(),
    wait: () => new Promise((resolve) => window.setTimeout(resolve, 0)),
    replayBudget: Platform.isMobile ? 10000 : 5000,
    afterMove: () => this.liveJournal(),
    // A journal begun earlier gets what was played since it was last written (the app was closed before it could be).
    afterResume: () => {
      if (this.runs.run?.journal) this.liveJournal();
    },
  });
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

    // Coming back to the app (another device may have played on meanwhile): the run is read again if it moved.
    this.registerDomEvent(window, "focus", () => void this.runFileChanged());
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") void this.runFileChanged();
    });

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
    await this.runs.refreshSaves();
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

  /** A run file changed on another device: compile again when the run there is not the one here. */
  private async runFileChanged(): Promise<void> {
    if (await this.runs.synced()) this.schedule();
  }

  onunload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.folderTimer !== null) window.clearTimeout(this.folderTimer);
  }

  // --- PlayController ---

  startAt(path: string | null): void {
    this.runs.startAt(path);
  }

  restart(): void {
    this.runs.restart();
  }

  choose(index: number, value?: string | string[]): void {
    this.runs.choose(index, value);
  }

  back(): void {
    this.runs.back();
  }

  selectCharacter(id: string): void {
    this.runs.selectCharacter(id);
  }

  setStoryLanguage(lang: string): void {
    if (this.runs.replaying) return;
    this.config.storyLanguage = lang;
    void this.saveData(this.config);
    this.runs.setLanguage(lang);
  }

  saveGame(name?: string): Promise<SaveInfo | null> {
    return this.runs.save(name);
  }

  loadGame(id: string): void {
    void this.runs.load(id);
  }

  renameSave(id: string, name: string): Promise<void> {
    return this.runs.rename(id, name);
  }

  deleteSave(id: string): Promise<void> {
    return this.runs.remove(id);
  }

  savesForRoot(): SaveInfo[] {
    return this.runs.saves;
  }

  currentRun(): Run | null {
    return this.runs.run;
  }

  runsForRoot(): Promise<Run[]> {
    return this.runs.runs();
  }

  askOracle(question: string, odds: Odds): void {
    this.runs.askOracle(question, odds);
  }

  rollTray(formula: string, table?: string): void {
    this.runs.rollTray(formula, table);
  }

  adjustResource(id: string, delta: number, value?: number): void {
    this.runs.adjustResource(id, delta, value);
  }

  changeRecord(id: string, op: "add" | "remove", entry: string): void {
    this.runs.changeRecord(id, op, entry);
  }

  /** Player mode on or off; turning it on locks the main story (so opening a chapter does not switch away from it). */
  togglePlayerMode(): void {
    this.config.playerMode = !(this.config.playerMode ?? false);
    void this.saveData(this.config);
    if (this.config.playerMode && this.config.locked === null && this.root !== null) void this.updateLock(this.root);
    // Leaving player mode: a waiting update is applied, as edits are in author mode.
    if (!this.config.playerMode && this.runs.update) this.runs.useNewest();
    this.pushState();
  }

  /** Writes the run so far as a file (a backup, or to move it elsewhere): <save folder>/_exports/<story> <time>.json. */
  async exportRun(): Promise<{ path: string | null }> {
    const whole = this.runs.whole(), root = this.runs.root;
    if (!whole || root === null) {
      new Notice(T().nothingToSave);
      return { path: null };
    }
    const now = new Date();
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
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    // The file may come from anywhere: only a run a replay can take is imported.
    const run = parseRun(await this.app.vault.read(file));
    if (!run) {
      new Notice(T().notARun(path));
      return null;
    }
    const saved = await this.runs.import(run, file.basename);
    if (saved) new Notice(T().runImported(saved.name));
    return saved;
  }

  private pickRunToImport(): void {
    const files = this.app.vault.getFiles().filter((f) => f.extension === "json");
    new RunFileModal(this.app, files, (f) => void this.importRun(f.path)).open();
  }

  dismissStop(): void {
    this.runs.dismissStop();
  }

  continueByIndex(): void {
    void this.runs.continueByIndex();
  }

  useOlder(): void {
    void this.runs.useOlder();
  }

  useNewest(): void {
    this.runs.useNewest();
  }

  stopAtDrift(): void {
    this.runs.stopAtDrift();
  }

  dismissNote(): void {
    this.runs.dismissNote();
  }

  /**
   * The live journal (solo PRD §4.7): appends what was done since it was last written to the run's journal note
   * (made on the first move, in player mode or once a choice was made). Only appended, never rewritten; the
   * run records how far it got, so a write that did not happen (the app closed) is made up for next time.
   */
  private liveJournal(): void {
    const session = this.runs.session, root = this.runs.root;
    const live = this.runs.game?.config.journal?.live ?? this.config.liveJournal ?? false;
    if (!live || !session || root === null || !this.runs.run) return;
    if (!(this.config.playerMode ?? false) && session.taken.length === 0) return;
    this.runs.enqueue(async () => {
      const run = this.runs.run;
      if (!run || run.story !== root || this.runs.session !== session) return;
      const game = this.gameView();
      const language = (session.language ?? getLanguage()) === "en" ? "en" : "zh";
      const input = {
        language, log: session.log, turns: session.turns, rolls: game?.rolls ?? [], voices: game?.voices, skills: game?.skills,
        taken: session.taken.map((t, i) => ({ seq: t.seq, text: t.text, at: session.choicesMade[i]?.at ?? session.log.length, payload: t.payload, write: t.write === true })),
        asides: session.asides, writtenSeq: run.journal?.writtenSeq ?? -1, writtenTop: run.journal?.writtenTop ?? -1,
      } as const;
      const blocks = liveBlocks(input);
      try {
        const notes = new JournalNotes(this.app);
        const path = run.journal?.path;
        if (!notes.exists(path)) {
          // The first write (or the note was deleted): a new note with the header and the text so far.
          const title = storyName(root, this.app.vault.getName());
          const character = game?.characters.find((c) => c.id === game.current)?.name ?? null;
          const now = new Date();
          const fresh = liveBlocks({ ...input, writtenSeq: -1, writtenTop: -1 });
          const made = await notes.create(
            { template: this.runs.game?.config.journal?.path, root, title, character, now },
            liveHeader({ title, date: now, language, character }, input) + fresh.text,
            (p) => isDependency(p, this.files),
          );
          if ("refused" in made) {
            // Said once per story: every later move would come here again.
            if (this.journalRefused !== root) new Notice(T().journalIsDependency(made.refused));
            this.journalRefused = root;
            return;
          }
          // The run must know the note and how far it was written before anything else happens: written again.
          this.runs.recordJournal({ path: made.path, writtenSeq: fresh.writtenSeq, writtenTop: fresh.writtenTop });
          return;
        }
        if (blocks.text === "") return;
        await notes.append(path, blocks.text);
        this.runs.recordJournal({ path, writtenSeq: blocks.writtenSeq, writtenTop: blocks.writtenTop });
      } catch (e) {
        console.error("Inkwright: could not write the live journal", e);
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
    await this.runs.settled();
    this.store = this.makeStore();
    this.runs.rewrite();
    await this.runs.refreshSaves();
  }

  getLiveJournal(): boolean {
    return this.config.liveJournal ?? false;
  }

  async setLiveJournal(value: boolean): Promise<void> {
    this.config.liveJournal = value;
    await this.saveData(this.config);
  }

  getSyncMode(): SyncMode {
    return this.config.syncMode ?? "icloud";
  }

  /** The same folder read another way: every device's copy is still there, so the run in progress stays as it is. */
  async setSyncMode(value: SyncMode): Promise<void> {
    this.config.syncMode = value;
    await this.saveData(this.config);
    await this.runs.settled();
    this.store = this.makeStore();
    await this.runs.refreshSaves();
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
      mapImage: game ? await new GameFiles(this.app, path).dataUri(game.map?.image) : undefined,
      cardImages: game ? await new GameFiles(this.app, path).cardArtInline(game) : undefined,
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
    return resolveConfig(config, vaultConfigSource(this.app, this.readFile), folderOf(root));
  }

  /** Card art for the panel, by card id, as resource URLs; set with the engine. */
  private cardArt: Record<string, string> = {};

  /**
   * Writes the panel's run so far (text, choices, rolls) as a markdown note. The path comes from the
   * game note's `journal.path` (`{dir}`, `{story}`, `{date}`, `{time}`, `{character}`), default
   * `{dir}日志/{date} {time}.md` (`Journal/` in English); an existing note is never overwritten.
   */
  async writeJournal(): Promise<{ path: string | null }> {
    const session = this.runs.session;
    const root = this.root;
    if (!session || root === null || session.log.length === 0) {
      new Notice(T().nothingToJournal);
      return { path: null };
    }
    const game = this.gameView();
    const now = new Date();
    const story = storyName(root, this.app.vault.getName());
    const character = game?.characters.find((c) => c.id === game.current)?.name ?? null;
    const language = (session.language ?? getLanguage()) === "en" ? "en" : "zh";
    const text = renderJournal({
      title: story, date: now, language, character, log: session.log, turns: session.turns, choices: session.choicesMade.map((c) => this.runs.withCard(c)),
      rolls: game?.rolls ?? [], voices: game?.voices, skills: game?.skills, asides: session.asides,
    });
    const made = await new JournalNotes(this.app).create({ template: this.runs.game?.config.journal?.path, root, title: story, character, now }, text);
    if (!("path" in made)) return { path: null };
    new Notice(T().journalWritten + made.path);
    return { path: made.path };
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
    const out = folderOf(path) + engineFile(config);
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
    if (root !== this.root) this.graph = null;
    this.root = root;
    if (root === null) {
      this.latest.invalidate();
      this.runs.close();
      this.diagnostics = [];
      this.files = [];
      this.pushState();
      return;
    }
    // Everything that awaits happens inside the guarded run, so a stale run never touches state.
    const latest = await this.latest.run(async () => {
      const result = await compileStory(root, this.readFile);
      const game = await this.readGameNote(root, result.files);
      return { result, game };
    });
    if (latest === null) return;
    const { result, game } = latest;
    this.files = result.files;
    this.diagnostics = result.diagnostics;
    const engine = this.applyGameNote(game);
    // On a failed compile keep showing the last good graph, marked as stale.
    if (result.graph) this.graph = result.graph;
    this.graphStale = result.graph === null && this.graph !== null;
    const version = result.story
      ? { story: result.story, engine, hash: hash(`${result.story.ToJson() as string}\n${JSON.stringify(engine?.config ?? null)}`) }
      : null;
    await this.runs.compiledVersion(root, version, result.flows, engine);
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
      const enginePath = folderOf(root) + file;
      if (!included.includes(enginePath)) warnings.push(T().engineNotIncluded(file));
      else if ((await this.readFile(enginePath).catch(() => null)) !== generateInk(config)) warnings.push(T().engineStale(file));
    }
    // Images drawn by the panel are dependencies too, so a replaced or renamed picture shows up.
    const images = config ? new GameFiles(this.app, root).paths(config) : [];
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
    if (this.root !== null) this.cardArt = new GameFiles(this.app, this.root).cardArt(read.config);
    return engine;
  }

  private gameView(): GameView | null {
    const game = this.runs.game, session = this.runs.session;
    if (!game || !session) return null;
    const step = this.runs.last;
    // Names follow the story's language when it is bilingual, else the UI's.
    const lang = session.language ?? getLanguage();
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
      mapImage: this.root === null ? null : new GameFiles(this.app, this.root).url(game.config.map?.image),
      cardImages: this.cardArt,
      voices: session.log.map((p) => game.voiceOf(p)),
      turns: [...session.turns],
      rolls: game.rolls,
    };
  }

  /** What the play panel shows right now (also returned by the agent API). */
  snapshot(): PlayState {
    const r = this.runs, session = r.session, step = r.last;
    return {
      root: this.root,
      locked: this.config.locked,
      diagnostics: this.diagnostics,
      hasStory: session !== null,
      log: session?.log ?? [],
      choices: step?.choices ?? [],
      ended: step?.ended ?? false,
      runtimeErrors: step?.errors ?? [],
      inspection: session?.inspect() ?? null,
      flows: r.flows,
      startPoint: r.startPoint,
      canGoBack: session?.canGoBack ?? false,
      chosen: session?.lastChoice ? r.withCard(session.lastChoice) : null,
      pinned: this.config.pinBar ?? false,
      replay: r.replaying,
      stopped: r.stopped,
      note: r.note,
      playerMode: this.config.playerMode ?? false,
      asides: session ? [...session.asides] : [],
      trayTables: (r.game?.config.tables ?? []).filter((t) => t.oracle).map((t) => ({ id: t.id, name: localize(t.name, session?.language ?? getLanguage(), t.id) })),
      update: r.update,
      recap: r.recap,
      frozen: r.frozen ? { at: stamp(new Date(r.frozen.createdAt)) } : null,
      storyLanguage: session?.language ?? null,
      game: this.gameView(),
      saves: r.saves.map(({ id, name, savedAt }) => ({ id, name, savedAt })),
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
        leaf.view.showState({ graph: this.graph, stale: this.graphStale, visited, startPoint: this.runs.startPoint });
      }
    }
  }
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
