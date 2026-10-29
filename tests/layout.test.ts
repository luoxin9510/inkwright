import { describe, expect, test } from "vitest";
import { layoutGraph } from "../src/graph/layout";
import type { StoryGraph } from "../src/compile/graph";

function g(ids: string[], edges: [string, string][]): StoryGraph {
  return {
    nodes: ids.map((id) => ({
      id, kind: id === "@start" ? "start" : id === "@end" ? "end" : "knot", file: null, line: null, reachable: true,
    })),
    edges: edges.map(([from, to]) => ({ from, to, kind: "divert", count: 1 })),
  };
}

describe("layoutGraph", () => {
  test("forward edges point downwards and start is on top", () => {
    const L = layoutGraph(g(["@start", "a", "b", "c", "@end"], [["@start", "a"], ["a", "b"], ["a", "c"], ["b", "@end"], ["c", "@end"]]));
    const y = (id: string) => L.nodes.get(id)!.y;
    expect(y("@start")).toBeLessThan(y("a"));
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("b")).toBe(y("c"));
    expect(y("@end")).toBeGreaterThan(y("b"));
  });

  test("end is always on the bottom row", () => {
    const L = layoutGraph(g(["@start", "a", "b", "c", "@end"], [["@start", "a"], ["a", "@end"], ["a", "b"], ["b", "c"]]));
    const maxY = Math.max(...[...L.nodes.values()].map((n) => n.y));
    expect(L.nodes.get("@end")!.y).toBe(maxY);
  });

  test("cycles do not break layering", () => {
    const L = layoutGraph(g(["@start", "a", "b"], [["@start", "a"], ["a", "b"], ["b", "a"]]));
    expect(L.nodes.get("a")!.y).toBeLessThan(L.nodes.get("b")!.y);
  });

  test("no two nodes overlap and everything fits in the reported size", () => {
    const ids = ["@start", "a", "b", "c", "d", "e", "@end"];
    const L = layoutGraph(g(ids, [["@start", "a"], ["@start", "b"], ["@start", "c"], ["a", "d"], ["b", "d"], ["c", "e"], ["d", "@end"]]));
    const boxes = [...L.nodes.values()];
    for (const p of boxes) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(L.width);
      expect(p.y + p.h).toBeLessThanOrEqual(L.height);
      for (const q of boxes) {
        if (p === q) continue;
        const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
        expect(apart).toBe(true);
      }
    }
  });

  test("unconnected nodes still get a position", () => {
    const L = layoutGraph(g(["@start", "a", "lonely", "@end"], [["@start", "a"], ["a", "@end"]]));
    expect(L.nodes.get("lonely")).toBeDefined();
  });

  test("a node without predecessors sits just above the nodes it points to", () => {
    const L = layoutGraph(g(["@start", "a", "b", "c", "box", "@end"], [["@start", "a"], ["a", "b"], ["b", "c"], ["box", "c"], ["c", "@end"]]));
    expect(L.nodes.get("box")!.layer).toBe(L.nodes.get("c")!.layer - 1);
  });
});
