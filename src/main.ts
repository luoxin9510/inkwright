import { Notice, Plugin, TFile, moment, normalizePath, type WorkspaceLeaf } from "obsidian";
import { InkwrightApi } from "./api";
import { compileStory, type Flow } from "./compile/compile";
import type { StoryGraph } from "./compile/graph";
import { GRAPH_VIEW_TYPE, GraphView, type GraphController } from "./views/GraphView";
import type { Diagnostic } from "./compile/diagnostics";
import { PlaySession, findLanguageVar, type SaveData, type Step } from "./play/session";
import { LatestOnly, applyVaultEvent, isDependency, nextRoot } from "./root";
import { getLanguage, resolveLanguage, setLanguage, T, type LanguageSetting } from "./i18n";
import INK_RUNTIME from "virtual:ink-runtime";
import GAME_ENGINE from "virtual:game-engine";
import { buildWebPage, exportFileName, storyTitle } from "./export/web";
import { GameEngine } from "./game/engine";
import { findGameNote, loadGameConfig } from "./game/obsidian";
import { engineFile, localize, playableCharacters, type ConfigProblem, type GameConfig } from "./game/config";
import { generateInk } from "./game/inkgen";
import { resolveTables } from "./game/tables";
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
  /** Scriptable API for agents, e.g. via `obsidian eval`. See src/api.ts. */
  readonly api = new InkwrightApi(this);

  async onload(): Promise<void> {
    // Load settings first: the language (and command names below) depend on them.
    this.config = { locked: null, language: "auto", saves: {}, storyLanguage: null, ...((await this.loadData()) as Partial<Settings> | null) };
    // Obsidian sets moment's locale to its interface language.
    setLanguage(resolveLanguage(this.config.language, moment.locale()));
    this.addSettingTab(new InkwrightSettingTab(this.app, this));

    this.registerView(INK_VIEW_TYPE, (leaf) => new InkView(leaf));
    this.registerView(PLAY_VIEW_TYPE, (leaf) => new PlayView(leaf, this));
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));
    this.registerExtensions(["ink"], INK_VIEW_TYPE);

    this.addRibbonIcon("play", T().openPlay, () => void this.openPlay());
    this.addCommand({ id: "open-play", name: T().openPlay, callback: () => void this.openPlay() });
    this.addRibbonIcon("git-fork", T().openGraph, () => void this.openGraph());
    this.addCommand({ id: "open-graph", name: T().openGraph, callback: () => void this.openGraph() });
    this.addCommand({ id: "lock-main", name: T().lockCurrent, callback: () => void this.lockCurrent() });
    this.addCommand({ id: "unlock-main", name: T().unlock, callback: () => void this.setLocked(null) });
    this.addCommand({ id: "export-web", name: T().exportWeb, callback: () => void this.exportWeb() });
    this.addCommand({ id: "generate-engine", name: T().generateEngine, callback: () => void this.generateEngine() });
    this.addCommand({ id: "write-journal", name: T().writeJournal, callback: () => void this.writeJournal() });

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      // Focusing the play panel itself must not restart the story.
      if (leaf?.view instanceof PlayView) return;
      if (this.targetRoot() !== this.root) this.schedule();
    }));
    const touch = (path: string) => {
      if (isDependency(path, this.files)) this.schedule();
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
      touch(oldPath);
    }));

    this.app.workspace.onLayoutReady(() => {
      const locked = this.config.locked;
      if (locked !== null && !(this.app.vault.getAbstractFileByPath(locked) instanceof TFile)) {
        void this.updateLock(null);
      }
      this.schedule();
    });
  }

  onunload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  // --- PlayController ---

  startAt(path: string | null): void {
    this.startPoint = path;
    if (!this.session) return;
    this.apply(this.session.startAt(path));
  }

  restart(): void {
    if (!this.session) return;
    this.apply(this.session.restart());
  }

  choose(index: number): void {
    if (!this.session) return;
    // A choice that needs an item not carried is shown locked; it cannot be taken.
    const choice = this.last?.choices.find((c) => c.index === index);
    if (choice && this.game && !this.game.canChoose(choice)) return;
    this.apply(this.session.choose(index));
  }

  back(): void {
    const step = this.session?.back();
    if (step) this.apply(step);
  }

  selectCharacter(id: string): void {
    if (!this.game || !playableCharacters(this.game.config).some((c) => c.id === id)) return;
    this.character = id;
    // A new character means a new run from the current start point.
    this.startAt(this.startPoint);
  }

  setStoryLanguage(lang: string): void {
    this.config.storyLanguage = lang;
    void this.saveData(this.config);
    if (this.session) this.apply(this.session.setLanguage(lang));
  }

  /** Saves the current play state of the current main story; null when there is nothing to save. */
  async saveGame(name?: string): Promise<SaveSlot | null> {
    const data = this.session?.save();
    if (!data || this.root === null) {
      new Notice(T().nothingToSave);
      return null;
    }
    const list = (this.config.saves[this.root] ??= []);
    const slot: SaveSlot = {
      ...data,
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name?.trim() || T().saveName(list.length + 1),
      savedAt: new Date().toISOString(),
    };
    list.unshift(slot);
    await this.saveData(this.config);
    new Notice(T().saved + slot.name);
    this.pushState();
    return slot;
  }

  loadGame(id: string): void {
    const slot = this.savesForRoot().find((s) => s.id === id);
    if (!slot || !this.session) return;
    const step = this.session.load(slot);
    this.startPoint = this.session.startPoint;
    this.apply(step);
  }

  async deleteSave(id: string): Promise<void> {
    if (this.root === null) return;
    this.config.saves[this.root] = this.savesForRoot().filter((s) => s.id !== id);
    if (this.config.saves[this.root].length === 0) delete this.config.saves[this.root];
    await this.saveData(this.config);
    this.pushState();
  }

  savesForRoot(): SaveSlot[] {
    return this.root === null ? [] : this.config.saves[this.root] ?? [];
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
    const html = buildWebPage({
      title: storyTitle(result.story.globalTags, fallback),
      storyJson: result.story.ToJson() as string,
      runtime: INK_RUNTIME,
      id: path,
      languageVar: findLanguageVar(result.story),
      game: (await this.gameConfigFor(path)) ?? undefined,
      engine: GAME_ENGINE,
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
    return resolveTables(config, (p) => this.readFile(p).catch(() => null), root.slice(0, root.lastIndexOf("/") + 1));
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
      title: story, date: now, language, character, log: session.log, turns: session.turns, choices: session.choicesMade,
      rolls: game?.rolls ?? [], voices: game?.voices, skills: game?.skills,
    });
    const pad = (n: number) => String(n).padStart(2, "0");
    // A name goes into a file name: no separators, nothing a file system rejects, no "..".
    const clean = (v: string) => v.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\.{2,}/g, "-").trim();
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

  async openPlay(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(PLAY_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: PLAY_VIEW_TYPE, active: true });
    }
    if (leaf) void workspace.revealLeaf(leaf);
    this.schedule();
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
      return { result, game: await this.readGameNote(root, result.files) };
    });
    if (latest === null) return;
    const { result, game } = latest;
    this.files = result.files;
    this.diagnostics = result.diagnostics;
    this.applyGameNote(game);
    this.flows = result.flows;
    // On a failed compile keep showing the last good graph, marked as stale.
    if (result.graph) this.graph = result.graph;
    this.graphStale = result.graph === null && this.graph !== null;
    if (result.story) {
      // Keep the chosen start point across recompiles while it still exists.
      if (this.startPoint !== null && !this.flows.some((f) => f.path === this.startPoint)) this.startPoint = null;
      const game = this.game;
      this.session = new PlaySession(result.story, {
        language: this.config.storyLanguage ?? undefined,
        setup: game ? (story) => game.setup(story, this.character ?? undefined) : undefined,
      });
      this.apply(this.session.startAt(this.startPoint));
    } else {
      this.session = null;
      this.last = null;
      this.pushState();
    }
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
    return { note, config, warnings, files: resolved?.files ?? [] };
  }

  private applyGameNote(read: GameNoteRead | null): void {
    this.game = null;
    if (!read) return;
    // Edits to the game note, or to a note a table is read from, recompile like edits to any INCLUDEd file.
    for (const path of [read.note.path, ...read.files]) if (!this.files.includes(path)) this.files.push(path);
    for (const text of read.warnings) this.diagnostics.push({ severity: "warning", file: read.note.path, line: null, message: text, raw: "" });
    if (!read.config) return;
    if (this.character !== null && !playableCharacters(read.config).some((c) => c.id === this.character)) this.character = null;
    this.game = new GameEngine(read.config);
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
      chosen: this.session?.lastChoice ?? null,
      pinned: this.config.pinBar ?? false,
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
