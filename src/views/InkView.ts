import { EditorView } from "@codemirror/view";
import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { createInkState, replaceDocWithoutHistory } from "../editor/state";
import { T } from "../i18n";

export const INK_VIEW_TYPE = "ink-cn-editor";

export class InkView extends TextFileView {
  private cm: EditorView | null = null;
  /** Last known content, so a save that fires after close never writes an empty file. */
  private lastData = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return INK_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? T().editorName;
  }

  getIcon(): string {
    return "scroll-text";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("ink-cn-editor");
    this.cm = new EditorView({ parent: this.contentEl, state: this.freshState(this.lastData) });
  }

  async onClose(): Promise<void> {
    if (this.cm) this.lastData = this.cm.state.doc.toString();
    this.cm?.destroy();
    this.cm = null;
  }

  getViewData(): string {
    return this.cm ? this.cm.state.doc.toString() : this.lastData;
  }

  setViewData(data: string, clear: boolean): void {
    this.lastData = data;
    if (!this.cm) return;
    if (clear) this.cm.setState(this.freshState(data));
    else this.cm.dispatch(replaceDocWithoutHistory(this.cm.state, data));
  }

  clear(): void {
    this.lastData = "";
    this.cm?.setState(this.freshState(""));
  }

  goToLine(line: number): void {
    if (!this.cm) return;
    const doc = this.cm.state.doc;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
    this.cm.dispatch({ selection: { anchor: target.from, head: target.to }, scrollIntoView: true });
    this.cm.focus();
  }

  private freshState(doc: string) {
    return createInkState(doc, () => this.requestSave());
  }
}
