import { describe, expect, test } from "vitest";
import { undo, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { createInkState, replaceDocWithoutHistory } from "../src/editor/state";

function runUndo(state: EditorState): EditorState {
  let next = state;
  undo({ state, dispatch: (tr) => { next = tr.state; } });
  return next;
}

describe("editor state", () => {
  test("a freshly loaded file has nothing to undo", () => {
    const s = createInkState("Hello", () => {});
    expect(undoDepth(s)).toBe(0);
    expect(runUndo(s).doc.toString()).toBe("Hello");
  });

  test("reloading content does not create an undo step that blanks the file", () => {
    const s0 = createInkState("", () => {});
    const s1 = s0.update(replaceDocWithoutHistory(s0, "Loaded")).state;
    expect(s1.doc.toString()).toBe("Loaded");
    expect(runUndo(s1).doc.toString()).toBe("Loaded");
  });

  test("user edits are still undoable", () => {
    const s0 = createInkState("A", () => {});
    const s1 = s0.update({ changes: { from: 1, insert: "B" } }).state;
    expect(runUndo(s1).doc.toString()).toBe("A");
  });
});
