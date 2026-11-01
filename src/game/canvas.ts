// A map drawn in an Obsidian canvas: the first image node is the background, each text node a
// place (its first line is the id; a leading `?` marks it hidden at the start), each edge between
// two text nodes a link. Positions are the node centres relative to the image (or to the nodes'
// bounding box when there is no image). The game note's `places` add names, counters and overrides.
import { validateConfig, type ConfigProblem, type GameConfig, type MapDef, type PlaceDef } from "./config";

interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
}

interface CanvasEdge {
  fromNode: string;
  toNode: string;
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/** What a canvas gives a map: the image (a vault path), the size and the places with their links; null when the text is not a canvas. */
export function mapFromCanvas(text: string): { image?: string; width: number; height: number; places: PlaceDef[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as { nodes?: unknown }).nodes)) return null;
  const nodes = ((data as { nodes: unknown[] }).nodes).filter(isNode);
  const edges = (Array.isArray((data as { edges?: unknown }).edges) ? (data as { edges: unknown[] }).edges : []).filter(isEdge);
  const image = nodes.find((n) => n.type === "file" && n.file !== undefined && IMAGE.test(n.file));
  const texts = nodes.filter((n) => n.type === "text" && typeof n.text === "string" && n.text.trim() !== "");
  // Positions are relative to the image's top-left corner; without an image, to the places' bounding box with a margin.
  const pad = 40;
  const origin = image
    ? { x: image.x, y: image.y, width: image.width, height: image.height }
    : texts.length > 0
      ? (() => {
        const xs = texts.map((n) => n.x), ys = texts.map((n) => n.y);
        const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
        return { x, y, width: Math.max(...texts.map((n) => n.x + n.width)) + pad - x, height: Math.max(...texts.map((n) => n.y + n.height)) + pad - y };
      })()
      : { x: 0, y: 0, width: 100, height: 100 };
  const byNode = new Map<string, string>();
  const places: PlaceDef[] = [];
  for (const n of texts) {
    const first = (n.text ?? "").split(/\r?\n/)[0].trim();
    const hidden = first.startsWith("?");
    const id = (hidden ? first.slice(1) : first).trim();
    if (id === "") continue;
    byNode.set(n.id, id);
    places.push({ id, x: Math.round(n.x + n.width / 2 - origin.x), y: Math.round(n.y + n.height / 2 - origin.y), ...(hidden ? { hidden: true } : {}) });
  }
  const links = new Map<string, Set<string>>();
  for (const e of edges) {
    const a = byNode.get(e.fromNode), b = byNode.get(e.toNode);
    if (a === undefined || b === undefined || a === b) continue;
    (links.get(a) ?? links.set(a, new Set()).get(a))!.add(b);
    (links.get(b) ?? links.set(b, new Set()).get(b))!.add(a);
  }
  for (const p of places) {
    const l = links.get(p.id);
    if (l && l.size > 0) p.links = [...l];
  }
  return { ...(image?.file ? { image: image.file } : {}), width: Math.round(origin.width), height: Math.round(origin.height), places };
}

function isNode(n: unknown): n is CanvasNode {
  const o = n as Record<string, unknown> | null;
  return !!o && typeof o.id === "string" && typeof o.type === "string" && typeof o.x === "number" && typeof o.y === "number" && typeof o.width === "number" && typeof o.height === "number";
}

function isEdge(e: unknown): e is CanvasEdge {
  const o = e as Record<string, unknown> | null;
  return !!o && typeof o.fromNode === "string" && typeof o.toNode === "string";
}

function join(dir: string, path: string): string {
  const clean = path.replace(/^\.\//, "");
  return dir === "" || clean.startsWith("/") ? clean.replace(/^\/+/, "") : `${dir}${clean}`;
}

/**
 * Fills in a map that comes `from:` a canvas: geometry and links from the canvas, names, counters
 * and tokens from the note. A place the note lists but the canvas lacks keeps its own x/y or is
 * reported. The canvas is listed in `files` so the story recompiles when it changes.
 */
export async function resolveMap(
  config: GameConfig,
  read: (path: string) => Promise<string | null>,
  dir: string,
): Promise<{ config: GameConfig; problems: ConfigProblem[]; files: string[] }> {
  const map = config.map;
  if (!map || map.from === undefined) return { config, problems: [], files: [] };
  const path = join(dir, map.from);
  const text = await read(path);
  const canvas = text === null ? null : mapFromCanvas(text);
  if (!canvas) {
    // Keep `from`, so the note's deferred checks stay deferred; only places with a position can be drawn.
    const next: GameConfig = { ...config, map: { ...map, places: map.places.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) } };
    return { config: next, problems: [{ code: "mapFile", args: [map.from] }], files: [path] };
  }
  const problems: ConfigProblem[] = [];
  const overrides = new Map(map.places.map((p) => [p.id, p]));
  const places: PlaceDef[] = canvas.places.map((p) => {
    const o = overrides.get(p.id);
    overrides.delete(p.id);
    return o ? { ...p, ...o, x: Number.isFinite(o.x) ? o.x : p.x, y: Number.isFinite(o.y) ? o.y : p.y, links: o.links ?? p.links, hidden: o.hidden ?? p.hidden } : p;
  });
  for (const o of overrides.values()) {
    if (Number.isFinite(o.x) && Number.isFinite(o.y)) places.push(o);
    else problems.push({ code: "mapCanvasPlace", args: [o.id, map.from] });
  }
  const resolved: MapDef = {
    ...map, from: undefined, places,
    image: map.image ?? canvas.image, width: map.width ?? canvas.width, height: map.height ?? canvas.height,
  };
  const next = { ...config, map: resolved };
  const before = new Set(validateConfig(config).map((p) => JSON.stringify(p)));
  for (const p of validateConfig(next)) if (!before.has(JSON.stringify(p))) problems.push(p);
  return { config: next, problems, files: [path] };
}
