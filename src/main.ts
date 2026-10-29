import { Notice, Plugin, TFile, moment, type WorkspaceLeaf } from "obsidian";
import { InkwrightApi } from "./api";
import { compileStory, type Flow } from "./compile/compile";
import type { StoryGraph } from "./compile/graph";
import { GRAPH_VIEW_TYPE, GraphView, type GraphController } from "./views/GraphView";
import type { Diagnostic } from "./compile/diagnostics";
import { PlaySession, type SaveData, type Step } from "./play/session";
import { LatestOnly, applyVaultEvent, isDependency, nextRoot } from "./root";
import { T, resolveLanguage, setLanguage, type LanguageSetting } from "./i18n";
import { InkwrightSettingTab } from "./views/SettingTab";
import { INK_VIEW_TYPE, InkView } from "./views/InkView";
import { PLAY_VIEW_TYPE, PlayView, type PlayController, type PlayState } from "./views/PlayView";

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
}

export default class InkwrightPlugin extends Plugin implements PlayController, GraphController {
  private config: Settings = { locked: null, language: "auto", saves: {} };
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
  /** Scriptable API for agents, e.g. via `obsidian eval`. See src/api.ts. */
  readonly api = new InkwrightApi(this);

  async onload(): Promise<void> {
    // Load settings first: the language (and command names below) depend on them.
    this.config = { locked: null, language: "auto", saves: {}, ...(await this.loadData()) };
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

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      // Focusing the play panel itself must not restart the story.
      if (leaf?.view instanceof PlayView) return;
      if (this.targetRoot() !== this.root) this.schedule();
    }));
    const touch = (path: string) => {
      if (isDependency(path, this.files)) this.schedule();
    };
    this.registerEvent(this.app.vault.on("modify", (f) => touch(f.path)));
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
    if (this.session) this.apply(this.session.choose(index));
  }

  back(): void {
    const step = this.session?.back();
    if (step) this.apply(step);
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
    workspace.revealLeaf(leaf);
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

  // --- internals ---

  async openGraph(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(GRAPH_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    this.schedule();
  }

  async openPlay(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(PLAY_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: PLAY_VIEW_TYPE, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
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
    }
    this.root = root;
    if (root === null) {
      this.latest.invalidate();
      this.session = null;
      this.diagnostics = [];
      this.files = [];
      this.flows = [];
      this.last = null;
      this.pushState();
      return;
    }
    const result = await this.latest.run(() => compileStory(root, this.readFile));
    if (result === null) return;
    this.files = result.files;
    this.diagnostics = result.diagnostics;
    this.flows = result.flows;
    // On a failed compile keep showing the last good graph, marked as stale.
    if (result.graph) this.graph = result.graph;
    this.graphStale = result.graph === null && this.graph !== null;
    if (result.story) {
      // Keep the chosen start point across recompiles while it still exists.
      if (this.startPoint !== null && !this.flows.some((f) => f.path === this.startPoint)) this.startPoint = null;
      this.session = new PlaySession(result.story);
      this.apply(this.session.startAt(this.startPoint));
    } else {
      this.session = null;
      this.last = null;
      this.pushState();
    }
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
