import { InkList, type Story } from "inkjs/full";

export interface Inspection {
  variables: { name: string; value: string }[];
  visits: { path: string; count: number }[];
  /** Number of choices made so far. */
  turns: number;
}

/** Compiler-generated container names (choice/gather/index), not author-written knots. */
const INTERNAL = /^(\d+|[cg]-\d+)$/;

function format(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value instanceof InkList) return `(${value.toString()})`;
  return String(value);
}

/** Reads the current global variables and visit counts from a story's public state JSON. */
export function inspect(story: Story): Inspection {
  const json = JSON.parse(story.state.ToJson()) as {
    variablesState?: Record<string, unknown>;
    visitCounts?: Record<string, number>;
    turnIdx?: number;
  };
  // The state JSON omits variables still at their default value, so take the names
  // (in declaration order) from the variables state itself, falling back to the JSON.
  const globals = (story.variablesState as unknown as { _globalVariables?: Map<string, unknown> })._globalVariables;
  const names = globals instanceof Map ? [...globals.keys()] : Object.keys(json.variablesState ?? {});
  const variables = names.map((name) => ({
    name,
    value: format(story.variablesState[name]),
  }));
  const visits = Object.entries(json.visitCounts ?? {})
    .map(([path, count]) => ({ segs: path.split("."), count }))
    // Keep author-named containers (knots, stitches, labeled gathers/choices) and hide
    // the compiler-generated segments inside their paths, e.g. "k.s.0.talk" -> "k.s.talk".
    .filter(({ segs }) => segs[segs.length - 1] !== "" && !INTERNAL.test(segs[segs.length - 1]))
    .map(({ segs, count }) => ({ path: segs.filter((seg) => !INTERNAL.test(seg)).join("."), count }));
  return { variables, visits, turns: Math.max(0, (json.turnIdx ?? -1) + 1) };
}
