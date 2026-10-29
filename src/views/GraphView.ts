import { ItemView, type WorkspaceLeaf } from "obsidian";
import { END, START, type GraphNode, type StoryGraph } from "../compile/graph";
import { layoutGraph, nodeLabel, type Layout } from "../graph/layout";
import { T } from "../i18n";

export const GRAPH_VIEW_TYPE = "inkwright-graph";
const SVG = "http://www.w3.org/2000/svg";

export interface GraphState {
  graph: StoryGraph | null;
  /** True when the latest compile failed and `graph` is from the last good one. */
  stale: boolean;
  visited: Set<string>;
  startPoint: string | null;
}

export interface GraphController {
  openSource(file: string, line: number | null): Promise<void>;
  playFrom(path: string): void;
}

export class GraphView extends ItemView {
  private state: GraphState = { graph: null, stale: false, visited: new Set(), startPoint: null };
  private layout: Layout | null = null;
  private layoutFor: StoryGraph | null = null;
  private view = { x: 0, y: 0, k: 1 };
  private fitted = false;
  private svg: SVGSVGElement | null = null;
  private world: SVGGElement | null = null;
  private popover: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly controller: GraphController) {
    super(leaf);
  }

  getViewType(): string {
    return GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return T().graphName;
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("inkwright-graph");
    this.render();
  }

  showState(state: GraphState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    this.popover = null;
    const { graph } = this.state;
    if (!graph) {
      el.createEl("p", { text: T().noGraph, cls: "inkwright-hint" });
      return;
    }
    if (graph !== this.layoutFor) {
      this.layout = layoutGraph(graph);
      this.layoutFor = graph;
    }

    const bar = el.createDiv({ cls: "inkwright-graph-bar" });
    bar.createEl("button", { text: T().fit }).onclick = () => this.fit();
    const legend = bar.createDiv({ cls: "inkwright-graph-legend" });
    legend.createSpan({ cls: "lg-visited", text: T().legendVisited });
    legend.createSpan({ cls: "lg-unreachable", text: T().legendUnreachable });
    legend.createSpan({ cls: "lg-divert", text: T().legendDivert });
    legend.createSpan({ cls: "lg-tunnel", text: T().legendTunnel });
    legend.createSpan({ cls: "lg-thread", text: T().legendThread });
    if (this.state.stale) el.createDiv({ cls: "inkwright-hint-small", text: T().graphStale });

    const host = el.createDiv({ cls: "inkwright-graph-host" });
    this.svg = document.createElementNS(SVG, "svg");
    host.appendChild(this.svg);
    const marker = this.svg.appendChild(document.createElementNS(SVG, "defs")).appendChild(document.createElementNS(SVG, "marker"));
    for (const [k, v] of Object.entries({ id: "iw-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" })) {
      marker.setAttribute(k, v);
    }
    marker.appendChild(document.createElementNS(SVG, "path")).setAttribute("d", "M0,0 L10,5 L0,10 z");
    this.world = document.createElementNS(SVG, "g");
    this.svg.appendChild(this.world);
    this.drawEdges(graph);
    this.drawNodes(graph);
    this.bindPanZoom(host);
    if (!this.fitted) window.requestAnimationFrame(() => this.fit());
    else this.applyView();
  }

  private drawEdges(graph: StoryGraph): void {
    const L = this.layout!;
    for (const e of graph.edges) {
      const a = L.nodes.get(e.from);
      const b = L.nodes.get(e.to);
      if (!a || !b) continue;
      let d: string;
      if (b.y > a.y) {
        const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y, my = (y1 + y2) / 2;
        d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
      } else {
        // Back or sideways edge: loop around the right-hand side.
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x + b.w, y2 = b.y + b.h / 2, out = 48 + Math.abs(y1 - y2) * 0.15;
        d = `M${x1},${y1} C${Math.max(x1, x2) + out},${y1} ${Math.max(x1, x2) + out},${y2} ${x2},${y2}`;
      }
      const path = this.world!.appendChild(document.createElementNS(SVG, "path"));
      path.setAttribute("d", d);
      path.setAttribute("class", `iw-edge iw-edge-${e.kind}`);
      path.setAttribute("marker-end", "url(#iw-arrow)");
      path.style.strokeWidth = String(1.4 + Math.min(e.count - 1, 3) * 0.6);
    }
  }

  private drawNodes(graph: StoryGraph): void {
    const L = this.layout!;
    for (const n of graph.nodes) {
      const p = L.nodes.get(n.id)!;
      const g = this.world!.appendChild(document.createElementNS(SVG, "g"));
      const cls = ["iw-node", `iw-${n.kind}`];
      if (!n.reachable) cls.push("iw-unreachable");
      if (this.state.visited.has(n.id)) cls.push("iw-visited");
      if (this.state.startPoint === n.id) cls.push("iw-startpoint");
      g.setAttribute("class", cls.join(" "));
      g.setAttribute("transform", `translate(${p.x},${p.y})`);
      const rect = g.appendChild(document.createElementNS(SVG, "rect"));
      rect.setAttribute("width", String(p.w));
      rect.setAttribute("height", String(p.h));
      rect.setAttribute("rx", n.kind === "knot" ? "6" : "16");
      const text = g.appendChild(document.createElementNS(SVG, "text"));
      text.setAttribute("x", String(p.w / 2));
      text.setAttribute("y", String(p.h / 2));
      text.textContent = n.id === START ? T().graphStart : n.id === END ? T().graphEnd : nodeLabel(n.id);
      const title = g.appendChild(document.createElementNS(SVG, "title"));
      title.textContent = n.file ? `${n.id}\n${n.file}:${n.line ?? "?"}` : n.id;
      g.addEventListener("click", (ev) => {
        if (this.dragged) return;
        ev.stopPropagation();
        this.showPopover(n, ev);
      });
    }
  }

  private showPopover(n: GraphNode, ev: MouseEvent): void {
    this.popover?.remove();
    if (n.kind === "start" || n.kind === "end") return;
    const host = this.contentEl.querySelector(".inkwright-graph-host") as HTMLElement;
    const r = host.getBoundingClientRect();
    const pop = host.createDiv({ cls: "inkwright-graph-popover" });
    pop.style.left = `${ev.clientX - r.left}px`;
    pop.style.top = `${ev.clientY - r.top}px`;
    pop.createDiv({ cls: "inkwright-graph-popover-title", text: n.id });
    if (n.file) {
      pop.createEl("button", { text: T().openSource }).onclick = () => {
        pop.remove();
        void this.controller.openSource(n.file!, n.line);
      };
    }
    pop.createEl("button", { text: T().playFromHere }).onclick = () => {
      pop.remove();
      this.controller.playFrom(n.id);
    };
    this.popover = pop;
  }

  // --- pan & zoom (mouse, trackpad, touch) ---

  private dragged = false;

  private bindPanZoom(host: HTMLElement): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let pinch: { dist: number; k: number } | null = null;

    host.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x: e.clientX, y: e.clientY };
      this.dragged = false;
      if (pointers.size === 2) {
        const [p, q] = [...pointers.values()];
        pinch = { dist: Math.hypot(p.x - q.x, p.y - q.y), k: this.view.k };
      }
    });
    host.addEventListener("pointermove", (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
        if (!this.dragged) host.setPointerCapture(e.pointerId);
        this.dragged = true;
      }
      if (!this.dragged) return;
      if (pinch && pointers.size === 2) {
        const [p, q] = [...pointers.values()];
        const r = host.getBoundingClientRect();
        this.zoomAt((p.x + q.x) / 2 - r.left, (p.y + q.y) / 2 - r.top, (pinch.k * Math.hypot(p.x - q.x, p.y - q.y)) / pinch.dist);
      } else if (pointers.size === 1) {
        this.view.x += e.clientX - prev.x;
        this.view.y += e.clientY - prev.y;
        this.applyView();
      }
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);
    host.addEventListener("click", () => {
      if (!this.dragged) this.popover?.remove();
    });
    host.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = host.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, this.view.k * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  private zoomAt(cx: number, cy: number, k: number): void {
    k = Math.min(3, Math.max(0.2, k));
    this.view.x = cx - ((cx - this.view.x) * k) / this.view.k;
    this.view.y = cy - ((cy - this.view.y) * k) / this.view.k;
    this.view.k = k;
    this.applyView();
  }

  private fit(): void {
    const host = this.contentEl.querySelector<HTMLElement>(".inkwright-graph-host");
    if (!host || !this.layout) return;
    const { width, height } = host.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const k = Math.min(1.5, Math.max(0.2, Math.min(width / this.layout.width, height / this.layout.height)));
    this.view = { k, x: (width - this.layout.width * k) / 2, y: Math.max(0, (height - this.layout.height * k) / 2) };
    this.fitted = true;
    this.applyView();
  }

  private applyView(): void {
    this.world?.setAttribute("transform", `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`);
  }
}
