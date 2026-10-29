import { END, START, type StoryGraph } from "../compile/graph";

export interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
}

export interface Layout {
  nodes: Map<string, Placed>;
  width: number;
  height: number;
}

const NODE_H = 36;
const GAP_X = 32;
const GAP_Y = 56;
const PAD = 24;

/** Rough label width: CJK characters are about twice as wide as Latin ones. */
export function nodeWidth(label: string): number {
  let w = 0;
  for (const ch of label) w += ch.charCodeAt(0) > 0x2e80 ? 14 : 8;
  return Math.max(72, Math.min(240, w + 28));
}

export function nodeLabel(id: string): string {
  return id === START ? "▶" : id === END ? "■" : id.slice(id.lastIndexOf(".") + 1);
}

/**
 * Layered top-down layout: back edges (found by DFS from the start) are ignored
 * for layering, each node sits one layer below its deepest predecessor, END goes
 * to the bottom row, and a few barycenter sweeps reduce crossings.
 */
export function layoutGraph(graph: StoryGraph): Layout {
  const ids = graph.nodes.map((n) => n.id);
  const known = new Set(ids);
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of graph.edges) if (known.has(e.from) && known.has(e.to)) succ.get(e.from)!.push(e.to);

  // Classify back edges with a recursive DFS (story graphs are small).
  const state = new Map<string, 0 | 1 | 2>();
  const forward = new Map<string, string[]>(ids.map((id) => [id, []]));
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of succ.get(id)!) {
      if (state.get(to) === 1) continue; // back edge
      forward.get(id)!.push(to);
      if (!state.get(to)) visit(to);
    }
    state.set(id, 2);
  };
  if (known.has(START)) visit(START);
  for (const id of ids) if (!state.get(id)) visit(id);

  const preds0 = (id: string) => [...forward].filter(([, tos]) => tos.includes(id)).map(([from]) => from);

  // Longest-path layering over the forward (acyclic) edges.
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const tos of forward.values()) for (const to of tos) indeg.set(to, indeg.get(to)! + 1);
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const to of forward.get(id)!) {
      layer.set(to, Math.max(layer.get(to)!, layer.get(id)! + 1));
      indeg.set(to, indeg.get(to)! - 1);
      if (indeg.get(to) === 0) queue.push(to);
    }
  }
  // Nodes nothing points to (other than the start) sit just above their nearest target
  // instead of floating on the top row.
  for (const id of ids) {
    if (id === START || preds0(id).length > 0) continue;
    const below = forward.get(id)!.map((to) => layer.get(to)!);
    if (below.length) layer.set(id, Math.max(0, Math.min(...below) - 1));
  }
  if (known.has(END)) {
    const deepest = Math.max(0, ...ids.filter((id) => id !== END).map((id) => layer.get(id)!));
    layer.set(END, deepest + 1);
  }

  const depth = Math.max(...ids.map((id) => layer.get(id)!)) + 1;
  const rows: string[][] = Array.from({ length: depth }, () => []);
  for (const id of ids) rows[layer.get(id)!].push(id);

  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [from, tos] of forward) for (const to of tos) preds.get(to)!.push(from);
  const pos = () => {
    const m = new Map<string, number>();
    rows.forEach((row) => row.forEach((id, i) => m.set(id, i)));
    return m;
  };
  const sweep = (row: string[], neighbours: (id: string) => string[], index: Map<string, number>) => {
    const key = new Map(row.map((id, i) => {
      const ns = neighbours(id);
      return [id, ns.length ? ns.reduce((s, n) => s + index.get(n)!, 0) / ns.length : i];
    }));
    row.sort((a, b) => key.get(a)! - key.get(b)!);
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let l = 1; l < depth; l++) sweep(rows[l], (id) => preds.get(id)!, pos());
    for (let l = depth - 2; l >= 0; l--) sweep(rows[l], (id) => forward.get(id)!, pos());
  }

  const widths = new Map(ids.map((id) => [id, nodeWidth(nodeLabel(id))]));
  const rowWidth = (row: string[]) => row.reduce((s, id) => s + widths.get(id)!, 0) + GAP_X * Math.max(0, row.length - 1);
  const maxRow = Math.max(...rows.map(rowWidth));
  const nodes = new Map<string, Placed>();
  rows.forEach((row, l) => {
    let x = PAD + (maxRow - rowWidth(row)) / 2;
    for (const id of row) {
      nodes.set(id, { x, y: PAD + l * (NODE_H + GAP_Y), w: widths.get(id)!, h: NODE_H, layer: l });
      x += widths.get(id)! + GAP_X;
    }
  });
  return { nodes, width: maxRow + 2 * PAD, height: 2 * PAD + depth * NODE_H + (depth - 1) * GAP_Y };
}
