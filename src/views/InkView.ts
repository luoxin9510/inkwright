import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { inkHighlight } from "../editor/highlight";
import { T } from "../i18n";

export const INK_VIEW_TYPE = "ink-cn-editor";

export class InkView extends TextFileView {
  private cm: EditorView | null = null;
  private loading = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return INK_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? T.editorName;
  }

  getIcon(): string {
    return "scroll-text";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("ink-cn-editor");
    this.cm = new EditorView({
      parent: this.contentEl,
      state: EditorState.create({
        doc: "",
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          inkHighlight,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !this.loading) this.requestSave();
          }),
        ],
      }),
    });
  }

  async onClose(): Promise<void> {
    this.cm?.destroy();
    this.cm = null;
  }

  getViewData(): string {
    return this.cm?.state.doc.toString() ?? "";
  }

  setViewData(data: string, _clear: boolean): void {
    if (!this.cm) return;
    this.loading = true;
    this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: data } });
    this.loading = false;
  }

  clear(): void {
    this.setViewData("", true);
  }

  goToLine(line: number): void {
    if (!this.cm) return;
    const doc = this.cm.state.doc;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
    this.cm.dispatch({ selection: { anchor: target.from, head: target.to }, scrollIntoView: true });
    this.cm.focus();
  }
}
