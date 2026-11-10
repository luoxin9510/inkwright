import { MarkdownView, Notice, TFile, normalizePath, type App } from "obsidian";
import { T } from "./i18n";
import { journalPath } from "./play/journal";
import { folderOf } from "./paths";

/**
 * Journal notes in the vault. A new note goes to a free path made from the game note's `journal.path` template
 * (default `{dir}日志/{date} {time}.md`, `{dir}Journal/…` in English), its folders made, never over an existing
 * note; appending goes through the editor when the note is open there, so the player's cursor and edits are kept.
 */
export class JournalNotes {
  constructor(private readonly app: App) {}

  /** Whether a journal note is still there (it may have been deleted or moved). */
  exists(path: string | undefined): path is string {
    return path !== undefined && this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  /**
   * Makes a new journal note with `text`, from the story's `root` and the run's `character`. A path that `refuse`
   * turns down is not written and comes back as `refused`.
   */
  async create(
    at: { template: string | undefined; root: string; title: string; character: string | null; now: Date },
    text: string,
    refuse: (path: string) => boolean = () => false,
  ): Promise<{ path: string } | { refused: string }> {
    const made = journalPath(at.template ?? T().journalDefaultPath, { dir: folderOf(at.root), story: at.title, character: at.character, now: at.now });
    if (made.unknown.length > 0) new Notice(T().journalUnknownKey(made.unknown.join(", ")));
    let path = normalizePath(made.path);
    if (refuse(path)) return { refused: path };
    const folder = path.slice(0, path.lastIndexOf("/"));
    let sofar = "";
    for (const part of folder === "" ? [] : folder.split("/")) {
      sofar = sofar === "" ? part : `${sofar}/${part}`;
      if (!this.app.vault.getAbstractFileByPath(sofar)) await this.app.vault.createFolder(sofar);
    }
    if (this.app.vault.getAbstractFileByPath(path)) {
      const base = path.slice(0, -3);
      for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${base} (${n}).md`;
    }
    await this.app.vault.create(path, text);
    return { path };
  }

  /** Appends to a journal note that exists. */
  async append(path: string, text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path && view.getMode() === "source") {
        const editor = view.editor;
        const last = editor.lastLine();
        editor.replaceRange(text, { line: last, ch: editor.getLine(last).length });
        return;
      }
    }
    await this.app.vault.process(file, (data) => data + text);
  }
}
