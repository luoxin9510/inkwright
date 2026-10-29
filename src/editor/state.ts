import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { inkHighlight } from "./highlight";

/** A fresh editor state: loading a file this way leaves nothing to undo. */
export function createInkState(doc: string, onUserChange: () => void): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      inkHighlight,
      EditorView.updateListener.of((u) => {
        const byUser = u.transactions.some(
          (tr) => tr.docChanged && tr.annotation(Transaction.addToHistory) !== false,
        );
        if (byUser) onUserChange();
      }),
    ],
  });
}

/** Replaces the whole document (e.g. an external reload) without an undo step or a save. */
export function replaceDocWithoutHistory(state: EditorState, data: string): TransactionSpec {
  return {
    changes: { from: 0, to: state.doc.length, insert: data },
    annotations: Transaction.addToHistory.of(false),
  };
}
