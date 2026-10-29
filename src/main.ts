import { Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { compileStory } from "./compile/compile";
import type { Diagnostic } from "./compile/diagnostics";
import { PlaySession, type Paragraph, type Step } from "./play/session";
import { LatestOnly, applyVaultEvent, isDependency, resolveRoot } from "./root";
import { T } from "./i18n";
import { INK_VIEW_TYPE, InkView } from "./views/InkView";
import { PLAY_VIEW_TYPE, PlayView, type PlayController } from "./views/PlayView";

interface Settings {
  locked: string | null;
}

export default class InkCnPlugin extends Plugin implements PlayController {
  private config: Settings = { locked: null };
  private latest = new LatestOnly();
  private timer: number | null = null;
  private files: string[] = [];
  private diagnostics: Diagnostic[] = [];
  private root: string | null = null;
  private session: PlaySession | null = null;
  private log: Paragraph[] = [];
  private last: Step | null = null;

  async onload(): Promise<void> {
    this.config = { locked: null, ...(await this.loadData()) };

    this.registerView(INK_VIEW_TYPE, (leaf) => new InkView(leaf));
    this.registerView(PLAY_VIEW_TYPE, (leaf) => new PlayView(leaf, this));
    this.registerExtensions(["ink"], INK_VIEW_TYPE);

    this.addRibbonIcon("play", T.openPlay, () => void this.openPlay());
    this.addCommand({ id: "open-play", name: T.openPlay, callback: () => void this.openPlay() });
    this.addCommand({ id: "lock-main", name: T.lockCurrent, callback: () => void this.lockCurrent() });
    this.addCommand({ id: "unlock-main", name: T.unlock, callback: () => void this.setLocked(null) });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.schedule()));
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

    this.app.workspace.onLayoutReady(() => this.schedule());
  }

  onunload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  // --- PlayController ---

  restart(): void {
    if (!this.session) return;
    this.log = [];
    this.apply(this.session.restart());
  }

  choose(index: number): void {
    if (this.session) this.apply(this.session.choose(index));
  }

  toggleLock(): void {
    if (this.config.locked !== null) void this.setLocked(null);
    else void this.lockCurrent();
  }

  async openDiagnostic(d: Diagnostic): Promise<void> {
    await this.app.workspace.openLinkText(d.file, "");
    if (d.line !== null) this.app.workspace.getActiveViewOfType(InkView)?.goToLine(d.line);
  }

  // --- internals ---

  private async openPlay(): Promise<void> {
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
      new Notice(T.lockNotInk);
      return;
    }
    await this.setLocked(f.path);
    new Notice(T.locked + f.path);
  }

  private async setLocked(path: string | null): Promise<void> {
    await this.updateLock(path);
    if (path === null) new Notice(T.unlocked);
  }

  private async updateLock(path: string | null): Promise<void> {
    if (path === this.config.locked) return;
    this.config.locked = path;
    await this.saveData(this.config);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.recompile(), 300);
  }

  private readFile = async (path: string): Promise<string> => {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error("not a file: " + path);
    return this.app.vault.cachedRead(f);
  };

  private async recompile(): Promise<void> {
    const root = resolveRoot(this.app.workspace.getActiveFile()?.path ?? null, this.config.locked);
    this.root = root;
    if (root === null) {
      this.session = null;
      this.diagnostics = [];
      this.files = [];
      this.log = [];
      this.last = null;
      this.pushState();
      return;
    }
    const result = await this.latest.run(() => compileStory(root, this.readFile));
    if (result === null) return;
    this.files = result.files;
    this.diagnostics = result.diagnostics;
    this.log = [];
    if (result.story) {
      this.session = new PlaySession(result.story);
      this.apply(this.session.start());
    } else {
      this.session = null;
      this.last = null;
      this.pushState();
    }
  }

  private apply(step: Step): void {
    this.log.push(...step.paragraphs);
    this.last = step;
    this.pushState();
  }

  private pushState(): void {
    const step = this.last;
    for (const leaf of this.app.workspace.getLeavesOfType(PLAY_VIEW_TYPE)) {
      if (!(leaf.view instanceof PlayView)) continue;
      leaf.view.showState({
        root: this.root,
        locked: this.config.locked,
        diagnostics: this.diagnostics,
        hasStory: this.session !== null,
        log: this.log,
        choices: step?.choices ?? [],
        ended: step?.ended ?? false,
        runtimeErrors: step?.errors ?? [],
      });
    }
  }
}
