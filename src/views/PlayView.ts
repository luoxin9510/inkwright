import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Diagnostic } from "../compile/diagnostics";
import { T } from "../i18n";
import type { Inspection } from "../play/inspect";
import type { Choice, Paragraph } from "../play/session";

export const PLAY_VIEW_TYPE = "inkwright-play";

export interface PlayState {
  root: string | null;
  locked: string | null;
  diagnostics: Diagnostic[];
  hasStory: boolean;
  log: Paragraph[];
  choices: Choice[];
  ended: boolean;
  runtimeErrors: string[];
  inspection: Inspection | null;
}

export interface PlayController {
  restart(): void;
  choose(index: number): void;
  toggleLock(): void;
  openDiagnostic(d: Diagnostic): void;
}

export class PlayView extends ItemView {
  private state: PlayState | null = null;
  private inspectorOpen = false;

  constructor(leaf: WorkspaceLeaf, private readonly controller: PlayController) {
    super(leaf);
  }

  getViewType(): string {
    return PLAY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return T().playName;
  }

  getIcon(): string {
    return "play";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("inkwright-play");
    this.render();
  }

  showState(state: PlayState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    const s = this.state;
    if (!s || s.root === null) {
      el.createEl("p", { text: T().noRoot, cls: "inkwright-hint" });
      return;
    }

    const bar = el.createDiv({ cls: "inkwright-bar" });
    const locked = s.locked !== null;
    bar.createSpan({
      cls: "inkwright-root",
      text: T().rootLine(s.root, locked),
    });
    bar.createEl("button", { text: T().restart }).onclick = () => this.controller.restart();
    bar.createEl("button", { text: locked ? T().unlockShort : T().lock }).onclick = () =>
      this.controller.toggleLock();

    if (s.inspection) this.renderInspector(el, s.inspection);

    if (s.diagnostics.length > 0) {
      const box = el.createDiv({ cls: "inkwright-diagnostics" });
      box.createEl("h4", { text: T().errors });
      for (const d of s.diagnostics) {
        const row = box.createDiv({ cls: `inkwright-diag inkwright-diag-${d.severity}` });
        const where = d.line !== null ? ` ${T().lineAt(d.line)}` : "";
        row.createSpan({ cls: "inkwright-diag-loc", text: `${d.file}${where}` });
        row.createDiv({ text: d.message });
        row.onclick = () => this.controller.openDiagnostic(d);
      }
    }

    if (!s.hasStory) return;

    const story = el.createDiv({ cls: "inkwright-story" });
    for (const p of s.log) {
      story.createEl("p", { text: p.text });
    }
    for (const msg of s.runtimeErrors) story.createDiv({ cls: "inkwright-diag inkwright-diag-error", text: msg });
    if (s.ended) story.createEl("p", { text: T().ended, cls: "inkwright-ended" });

    const choices = el.createDiv({ cls: "inkwright-choices" });
    for (const c of s.choices) {
      choices.createEl("button", { text: c.text, cls: "inkwright-choice" }).onclick = () =>
        this.controller.choose(c.index);
    }
    // Keep the newest text and choices in view, especially on small screens.
    choices.scrollIntoView({ block: "end" });
  }

  private renderInspector(el: HTMLElement, insp: Inspection): void {
    const box = el.createEl("details", { cls: "inkwright-inspector" });
    box.open = this.inspectorOpen;
    box.addEventListener("toggle", () => {
      this.inspectorOpen = box.open;
    });
    box.createEl("summary", { text: `${T().inspector} · ${T().turns(insp.turns)}` });
    const table = (title: string, rows: [string, string][]) => {
      box.createEl("h5", { text: title });
      if (rows.length === 0) {
        box.createDiv({ cls: "inkwright-inspector-empty", text: T().none });
        return;
      }
      const t = box.createEl("table");
      for (const [k, v] of rows) {
        const tr = t.createEl("tr");
        tr.createEl("td", { text: k });
        tr.createEl("td", { text: v });
      }
    };
    table(T().variables, insp.variables.map((v) => [v.name, v.value]));
    table(T().visits, insp.visits.map((v) => [v.path, String(v.count)]));
  }
}
