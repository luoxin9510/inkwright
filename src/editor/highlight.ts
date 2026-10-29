import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { tokenizeLine } from "./tokenize";

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let lastLine = -1;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.number > lastLine) {
        lastLine = line.number;
        for (const t of tokenizeLine(line.text)) {
          builder.add(line.from + t.from, line.from + t.to, Decoration.mark({ class: `ink-tok-${t.kind}` }));
        }
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const inkHighlight: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
