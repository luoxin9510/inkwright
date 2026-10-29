import type { Flow } from "./compile";

export const START = "@start";
export const END = "@end";

export interface GraphNode {
  /** Knot or "knot.stitch"; START / END for the two terminals (ink names cannot contain "@"). */
  id: string;
  kind: "start" | "end" | "knot" | "stitch";
  file: string | null;
  line: number | null;
  /** False when no chain of diverts leads here from the start. */
  reachable: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** "fall": a knot without content of its own runs into its first stitch. */
  kind: "divert" | "tunnel" | "thread" | "fall";
  count: number;
}

export interface StoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Duck-typed view of inkjs's parsed hierarchy. Class names are minified in the
// published bundle, so objects are told apart by their `typeName` strings.
interface Parsed {
  typeName: string;
  parent: Parsed | null;
  content: Parsed[] | null;
  identifier?: { name: string | null } | null;
  subFlowsByName?: Map<string, Parsed>;
  debugMetadata?: { startLineNumber: number } | null;
  // Divert
  targetContent?: Parsed | null;
  isTunnel?: boolean;
  isThread?: boolean;
  isFunctionCall?: boolean;
  isEnd?: boolean;
  isDone?: boolean;
}

/** Path of the knot or stitch that contains `obj`; START for top-level content; null inside functions. */
function flowOf(obj: Parsed | null | undefined): string | null {
  const names: string[] = [];
  for (let o = obj; o; o = o.parent) {
    if (o.typeName === "Function") return null;
    if (o.typeName === "Knot" || o.typeName === "Stitch") names.unshift(o.identifier?.name ?? "");
  }
  return names.length ? names.join(".") : START;
}

function* walk(o: Parsed): Generator<Parsed> {
  yield o;
  for (const c of o.content ?? []) yield* walk(c);
}

export function buildGraph(parsedStory: unknown, flows: Flow[]): StoryGraph {
  const story = parsedStory as Parsed;
  const edges = new Map<string, GraphEdge>();
  const add = (from: string, to: string, kind: GraphEdge["kind"]) => {
    if (from === to) return;
    const key = `${from}\u0000${to}\u0000${kind}`;
    const e = edges.get(key);
    if (e) e.count++;
    else edges.set(key, { from, to, kind, count: 1 });
  };

  for (const o of walk(story)) {
    if (o.typeName !== "Divert" || o.isFunctionCall) continue;
    const from = flowOf(o);
    if (from === null) continue;
    if (o.isEnd || o.isDone) {
      // Diverts the compiler adds (e.g. the implicit DONE at the end) have no source line.
      if (o.debugMetadata) add(from, END, "divert");
      continue;
    }
    const to = flowOf(o.targetContent);
    if (to === null || to === START) continue;
    add(from, to, o.isTunnel ? "tunnel" : o.isThread ? "thread" : "divert");
  }

  // A knot whose only content is stitches runs straight into the first one.
  for (const knot of story.subFlowsByName?.values() ?? []) {
    if (knot.typeName !== "Knot") continue;
    const hasOwnContent = (knot.content ?? []).some((c) => c.typeName !== "Stitch" && (c.content?.length ?? 0) > 0);
    const first = knot.subFlowsByName?.values().next().value;
    if (!hasOwnContent && first) add(knot.identifier!.name!, `${knot.identifier!.name}.${first.identifier!.name}`, "fall");
  }

  const nodes: GraphNode[] = [
    { id: START, kind: "start", file: null, line: null, reachable: true },
    ...flows.map((f) => ({ id: f.path, kind: f.kind, file: f.file, line: f.line, reachable: false })),
    { id: END, kind: "end", file: null, line: null, reachable: false },
  ];
  const edgeList = [...edges.values()];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue = [START];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edgeList) {
      const next = e.from === id ? byId.get(e.to) : undefined;
      if (next && !next.reachable) {
        next.reachable = true;
        queue.push(next.id);
      }
    }
  }
  return { nodes, edges: edgeList };
}
