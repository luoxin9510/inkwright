// A dungeon that grows while it is played (Four Against Darkness style): rooms are drawn from a set of
// shapes on a sheet of squares, each new room hung on a door of a room already there. Everything here
// is pure. The layout lives in one ink string (`rooms`), and the engine's EXTERNAL functions are thin
// wrappers around `startLayout`, `placeRoom`, `markRoom` and the counting helpers below, so back, save,
// load and replay keep the map: the string is story state like any other variable.
//
// A shape is rows of text: `#` is floor, anything else is empty. Its doors are written `side:n`:
// `top:3` is the door on the top edge of the first floor square in column 3 counting from the top
// (`bottom:3` from the bottom up, `left:2`/`right:2` the same along row 2). An `entry` door is the one
// the party came in by, for the first room. A shape without doors is a dead end that any side can be
// entered from.
import type { LocalizedText } from "./config";

export interface ShapeDef {
  id: string;
  name?: LocalizedText;
  cells: string[];
  doors?: string[];
  entry?: string;
  /** Defaults to a corridor when the floor has no 2x2 block, else a room. */
  kind?: "room" | "corridor";
}

export interface DungeonDef {
  /** The sheet, in squares. */
  width: number;
  height: number;
  shapes: ShapeDef[];
  /** A note that holds the shapes (see `shapesFromMarkdown`); they are added to the ones written here. */
  from?: string;
  /** Corridors may be lengthened by up to this many squares when that gives them a door onto empty sheet (Four Against Darkness: "stretch corridors 1 or 2 squares"). Off (0) by default. */
  stretch?: number;
  /** A room's door that touches the wall of an earlier room is an open passage into it instead of a dead end (corridor ends stay dead ends). Off by default. */
  passages?: boolean;
}

export type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];
const STEP: Record<Side, [number, number]> = { top: [-1, 0], right: [0, 1], bottom: [1, 0], left: [0, -1] };
const OPPOSITE: Record<Side, Side> = { top: "bottom", right: "left", bottom: "top", left: "right" };
const CLOCKWISE: Record<Side, Side> = { top: "right", right: "bottom", bottom: "left", left: "top" };

/** A door: on the `side` edge of the floor square (r, c). */
export interface Door {
  r: number;
  c: number;
  side: Side;
  /** The door the room was entered by (only the shape's own `entry`). */
  entry?: boolean;
}

/** A shape turned a quarter-turn `rot` times: its size, floor squares and doors, doors in reading order. */
export interface Oriented {
  h: number;
  w: number;
  cells: [number, number][];
  doors: Door[];
  /** Dead ends have no drawn doors; they can be entered anywhere along the wall. */
  open: boolean;
}

/** Why a shape cannot be used, or null. */
export function shapeProblem(shape: ShapeDef): string | null {
  if (shape.cells.length === 0 || !shape.cells.some((row) => row.includes("#"))) return "no floor";
  for (const spec of [...(shape.doors ?? []), ...(shape.entry !== undefined ? [shape.entry] : [])]) {
    if (!doorAt(shape, spec)) return `door "${spec}" is not on the floor`;
  }
  return null;
}

const floor = (shape: ShapeDef, r: number, c: number): boolean => shape.cells[r]?.[c] === "#";

/** The door a spec like `top:3` names, or null when the line holds no floor. */
function doorAt(shape: ShapeDef, spec: string): Door | null {
  const m = /^\s*(top|bottom|left|right)\s*:\s*(\d+)\s*$/i.exec(spec);
  if (!m) return null;
  const side = m[1].toLowerCase() as Side;
  const n = Number(m[2]) - 1;
  const h = shape.cells.length;
  const w = Math.max(...shape.cells.map((row) => row.length));
  if (side === "top") for (let r = 0; r < h; r++) if (floor(shape, r, n)) return { r, c: n, side };
  if (side === "bottom") for (let r = h - 1; r >= 0; r--) if (floor(shape, r, n)) return { r, c: n, side };
  if (side === "left") for (let c = 0; c < w; c++) if (floor(shape, n, c)) return { r: n, c, side };
  if (side === "right") for (let c = w - 1; c >= 0; c--) if (floor(shape, n, c)) return { r: n, c, side };
  return null;
}

const SIDE_ORDER: Record<Side, number> = { top: 0, right: 1, bottom: 2, left: 3 };

const orientCache = new WeakMap<ShapeDef, Oriented[]>();

/** The shape in each of its four orientations (0 = as drawn, then clockwise). */
export function orientations(shape: ShapeDef): Oriented[] {
  const cached = orientCache.get(shape);
  if (cached) return cached;
  const h0 = shape.cells.length;
  const w0 = Math.max(...shape.cells.map((row) => row.length));
  let cells: [number, number][] = [];
  for (let r = 0; r < h0; r++) for (let c = 0; c < w0; c++) if (floor(shape, r, c)) cells.push([r, c]);
  const specs = shape.doors ?? [];
  let doors: Door[] = specs.map((s) => doorAt(shape, s)).filter((d): d is Door => d !== null);
  const entry = shape.entry === undefined ? null : doorAt(shape, shape.entry);
  if (entry && !doors.some((d) => d.r === entry.r && d.c === entry.c && d.side === entry.side)) doors.push(entry);
  if (entry) doors = doors.map((d) => (d.r === entry.r && d.c === entry.c && d.side === entry.side ? { ...d, entry: true } : d));
  const open = specs.length === 0 && entry === null;
  let h = h0, w = w0;
  const out: Oriented[] = [];
  for (let rot = 0; rot < 4; rot++) {
    out.push({
      h, w, open,
      cells: [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      doors: [...doors].sort((a, b) => a.r - b.r || a.c - b.c || SIDE_ORDER[a.side] - SIDE_ORDER[b.side]),
    });
    // A quarter-turn clockwise: (r, c) → (c, h - 1 - r); the edge it faces turns with it.
    cells = cells.map(([r, c]) => [c, h - 1 - r] as [number, number]);
    doors = doors.map((d) => ({ ...d, r: d.c, c: h - 1 - d.r, side: CLOCKWISE[d.side] }));
    [h, w] = [w, h];
  }
  orientCache.set(shape, out);
  return out;
}

/** A corridor has no 2x2 block of floor (it is one square wide); `kind` in the shape overrides. */
export function isCorridor(shape: ShapeDef): boolean {
  if (shape.kind) return shape.kind === "corridor";
  return !shape.cells.some((row, r) => [...row].some((_, c) => floor(shape, r, c) && floor(shape, r, c + 1) && floor(shape, r + 1, c) && floor(shape, r + 1, c + 1)));
}

/**
 * A shape lengthened by `k` squares: the first pair of equal rows (a straight vertical run) gets `k` more copies,
 * else the first pair of equal columns. Door specs that count along the stretched direction move with it.
 * The shape itself when nothing can be stretched or `k` is 0.
 */
export function stretchedShape(shape: ShapeDef, k: number): ShapeDef {
  if (k <= 0) return shape;
  const cached = stretchCache.get(shape)?.get(k);
  if (cached) return cached;
  const w = Math.max(...shape.cells.map((row) => row.length));
  const rows = shape.cells.map((row) => row.padEnd(w, "."));
  const moveDoors = (sides: string[], at: number) => (spec: string) => {
    const m = /^\s*(top|bottom|left|right)\s*:\s*(\d+)\s*$/i.exec(spec);
    if (!m || !sides.includes(m[1].toLowerCase())) return spec;
    const n = Number(m[2]);
    return n > at ? `${m[1]}:${n + k}` : spec;
  };
  let out: ShapeDef = shape;
  const r = rows.findIndex((row, i) => i + 1 < rows.length && row.includes("#") && row === rows[i + 1]);
  if (r >= 0) {
    const cells = [...rows.slice(0, r + 1), ...Array<string>(k).fill(rows[r]), ...rows.slice(r + 1)];
    const move = moveDoors(["left", "right"], r + 1);
    out = { ...shape, id: shape.id, cells, doors: shape.doors?.map(move), entry: shape.entry === undefined ? undefined : move(shape.entry) };
  } else {
    const col = (c: number) => rows.map((row) => row[c]).join("");
    let c = -1;
    for (let i = 0; i + 1 < w; i++) if (col(i).includes("#") && col(i) === col(i + 1)) { c = i; break; }
    if (c >= 0) {
      const cells = rows.map((row) => row.slice(0, c + 1) + row[c].repeat(k) + row.slice(c + 1));
      const move = moveDoors(["top", "bottom"], c + 1);
      out = { ...shape, cells, doors: shape.doors?.map(move), entry: shape.entry === undefined ? undefined : move(shape.entry) };
    }
  }
  if (!stretchCache.has(shape)) stretchCache.set(shape, new Map());
  stretchCache.get(shape)!.set(k, out);
  return out;
}

const stretchCache = new WeakMap<ShapeDef, Map<number, ShapeDef>>();

/** The shape a room of the layout is drawn with: its shape, lengthened when the room says so. */
function shapeFor(def: DungeonDef, room: Pick<Room, "shape" | "stretch">): ShapeDef | undefined {
  const shape = def.shapes.find((s) => s.id === room.shape);
  return shape && room.stretch ? stretchedShape(shape, room.stretch) : shape;
}

/** One room as the layout string keeps it. */
export interface Room {
  shape: string;
  /** Squares a corridor was lengthened by (kept in the shape field as `shape*k`). */
  stretch?: number;
  /** Top-left square of the turned shape on the sheet. */
  x: number;
  y: number;
  rot: number;
  /** Indices (in reading order of the turned shape's doors) of the doors already used. */
  used: number[];
  /** Doors found later (a secret door), already used: on the `side` edge of the sheet square (r, c). Kept in the used field as `+r.c.side`. */
  extra?: { r: number; c: number; side: Side }[];
  mark: string;
}

/** The layout as the ink variable holds it: `shape:x:y:rot:used,used,+r.c.side:mark` per room (`shape*k` for a corridor lengthened by k), rooms joined by `;`. */
export function parseLayout(text: string): Room[] {
  const rooms: Room[] = [];
  for (const part of String(text ?? "").split(";")) {
    if (part.trim() === "") continue;
    const [field, x, y, rot, used = "", ...mark] = part.split(":");
    const [shape, k] = field.split("*");
    if (shape === "" || [x, y, rot].some((n) => !Number.isInteger(Number(n)))) continue;
    const items = used === "" ? [] : used.split(",");
    const extra = items.map((u) => /^\+(-?\d+)\.(-?\d+)\.(top|right|bottom|left)$/.exec(u)).filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ r: Number(m[1]), c: Number(m[2]), side: m[3] as Side }));
    rooms.push({
      shape, ...(Number(k) > 0 ? { stretch: Number(k) } : {}), x: Number(x), y: Number(y), rot: ((Number(rot) % 4) + 4) % 4,
      used: items.filter((u) => /^-?\d+$/.test(u)).map(Number),
      ...(extra.length > 0 ? { extra } : {}),
      mark: mark.join(":"),
    });
  }
  return rooms;
}

export function formatLayout(rooms: Room[]): string {
  return rooms.map((r) => {
    const used = [...[...new Set(r.used)].sort((a, b) => a - b).map(String), ...(r.extra ?? []).map((d) => `+${d.r}.${d.c}.${d.side}`)];
    return `${r.shape}${r.stretch ? `*${r.stretch}` : ""}:${r.x}:${r.y}:${r.rot}:${used.join(",")}:${r.mark.replace(/[;:]/g, " ")}`;
  }).join(";");
}

export type DoorState = "free" | "used" | "blocked";

/** A room on the sheet: the squares it really has and its doors with what is behind them. */
export interface PlacedRoom {
  /** 1-based, in the order rooms were added. */
  n: number;
  shape: string;
  corridor: boolean;
  cells: [number, number][];
  /** Doors in reading order of the turned shape, absolute squares; cut off by a neighbour or the sheet's edge → left out. */
  doors: { index: number; r: number; c: number; side: Side; state: DoorState; entry: boolean }[];
  mark: string;
  /** Fewer squares than the shape has: it was cut to fit. */
  truncated: boolean;
}

export interface Board {
  width: number;
  height: number;
  rooms: PlacedRoom[];
  /** Which room (1-based) holds a square, "r,c" → n. */
  owner: Map<string, number>;
}

const key = (r: number, c: number) => `${r},${c}`;

/** Lays the rooms on the sheet in order: a room keeps the squares that are on the sheet and no earlier room holds. */
export function boardOf(def: DungeonDef, rooms: Room[]): Board {
  const owner = new Map<string, number>();
  const placed: PlacedRoom[] = [];
  const pending: { room: Room; shape: ShapeDef; o: Oriented; n: number }[] = [];
  rooms.forEach((room, i) => {
    const shape = shapeFor(def, room);
    if (!shape) return;
    const o = orientations(shape)[room.rot];
    const n = i + 1;
    const cells: [number, number][] = [];
    for (const [r, c] of o.cells) {
      const ar = room.y + r, ac = room.x + c;
      if (ar < 0 || ac < 0 || ar >= def.height || ac >= def.width || owner.has(key(ar, ac))) continue;
      owner.set(key(ar, ac), n);
      cells.push([ar, ac]);
    }
    placed.push({ n, shape: shape.id, corridor: isCorridor(shape), cells, doors: [], mark: room.mark, truncated: cells.length < o.cells.length });
    pending.push({ room, shape, o, n });
  });
  // Doors are judged once every square is known: free when the square outside is on the sheet and empty.
  for (const { room, o, n } of pending) {
    const p = placed.find((q) => q.n === n)!;
    o.doors.forEach((d, index) => {
      const ar = room.y + d.r, ac = room.x + d.c;
      if (owner.get(key(ar, ac)) !== n) return;
      const [dr, dc] = STEP[d.side];
      const er = ar + dr, ec = ac + dc;
      const used = room.used.includes(index);
      const outside = er >= 0 && ec >= 0 && er < def.height && ec < def.width;
      // With passages on, a room's door against the wall of an earlier room opens into it.
      const into = owner.get(key(er, ec));
      const passage = def.passages === true && !p.corridor && into !== undefined && into < n;
      const state: DoorState = used || passage ? "used" : outside && into === undefined ? "free" : "blocked";
      p.doors.push({ index, r: ar, c: ac, side: d.side, state, entry: d.entry === true });
    });
    // Secret doors: always used, numbered after the shape's own (negative, so they never take a shape door's index).
    (room.extra ?? []).forEach((d, i) => {
      if (owner.get(key(d.r, d.c)) === n) p.doors.push({ index: -1 - i, r: d.r, c: d.c, side: d.side, state: "used", entry: false });
    });
  }
  return { width: def.width, height: def.height, rooms: placed, owner };
}

/** The doors still to be opened, in room order then door order: a room's own free doors when `room` is given. */
export function freeDoors(board: Board, room?: number): { room: number; index: number; r: number; c: number; side: Side }[] {
  return board.rooms
    .filter((p) => room === undefined || p.n === room)
    .flatMap((p) => p.doors.filter((d) => d.state === "free").map((d) => ({ room: p.n, index: d.index, r: d.r, c: d.c, side: d.side })));
}

/** The first room of a dungeon: an entrance shape drawn at the middle of the sheet's lower edge, its entry door used. Null when the shape is unknown. */
export function startLayout(def: DungeonDef, shapeId: string): string | null {
  const shape = def.shapes.find((s) => s.id === shapeId);
  if (!shape) return null;
  const o = orientations(shape)[0];
  const x = Math.max(0, Math.floor((def.width - o.w) / 2));
  const y = Math.max(0, def.height - o.h);
  const entry = o.doors.findIndex((d) => d.entry);
  return formatLayout([{ shape: shape.id, x, y, rot: 0, used: entry >= 0 ? [entry] : [], mark: "" }]);
}

export interface Placement {
  layout: string;
  /** The new room's number, or 0 when nothing could be drawn (the door only led into a wall). */
  room: number;
  truncated: boolean;
}

/**
 * Hangs a room of `shapeId` on the `k`-th free door of room `from` (1-based; `from` 0 = the free doors of the
 * whole dungeon in order). The shape is turned (and any of its doors used as the one the party enters by) until
 * it fits; if no way fits whole, the way that keeps the most squares wins and the room is cut off there, as the
 * book has it. When even the square behind the door is taken the door is used up and nothing is added.
 */
export function placeRoom(def: DungeonDef, layout: string, shapeId: string, from: number, k: number): Placement {
  const rooms = parseLayout(layout);
  const board = boardOf(def, rooms);
  const parent = freeDoors(board, from > 0 ? from : undefined)[Math.max(1, k) - 1];
  if (!parent) return { layout, room: 0, truncated: false };
  const use = (rs: Room[]) => rs.map((r, i) => (i + 1 === parent.room ? { ...r, used: [...r.used, parent.index] } : r));
  const way = hang(def, rooms, board, parent, shapeId, use);
  return way ? { layout: way.layout, room: way.room, truncated: way.truncated } : { layout: formatLayout(use(rooms)), room: 0, truncated: false };
}

/**
 * A secret door: a new door on a wall of room `from` (any edge of its squares with an empty square of the
 * sheet behind it, tried in reading order) with a room of `shapeId` hung on it, turned and cut as for
 * `placeRoom`. The first wall where the room fits whole wins, else the one that keeps the most squares.
 * Room 0 (and the layout unchanged) when no wall of the room has empty sheet behind it.
 */
export function placeSecret(def: DungeonDef, layout: string, shapeId: string, from: number): Placement {
  const rooms = parseLayout(layout);
  const board = boardOf(def, rooms);
  const room = board.rooms.find((p) => p.n === from);
  if (!room || !def.shapes.some((s) => s.id === shapeId)) return { layout, room: 0, truncated: false };
  let best: Placement | null = null;
  let bestFit = -1;
  const doorEdges = new Set(room.doors.map((d) => `${d.r},${d.c},${d.side}`));
  for (const [r, c] of room.cells) {
    for (const side of SIDES) {
      // A secret door is in a wall, not where a door is drawn already.
      if (doorEdges.has(`${r},${c},${side}`)) continue;
      const [dr, dc] = STEP[side];
      const er = r + dr, ec = c + dc;
      if (er < 0 || ec < 0 || er >= def.height || ec >= def.width || board.owner.has(key(er, ec))) continue;
      const use = (rs: Room[]) => rs.map((x, i) => (i + 1 === from ? { ...x, extra: [...(x.extra ?? []), { r, c, side }] } : x));
      const way = hang(def, rooms, board, { room: from, r, c, side }, shapeId, use);
      if (!way) continue;
      const fit = way.fit;
      if (!way.truncated) return { layout: way.layout, room: way.room, truncated: false };
      if (fit > bestFit) {
        best = { layout: way.layout, room: way.room, truncated: true };
        bestFit = fit;
      }
    }
  }
  return best ?? { layout, room: 0, truncated: false };
}

/** Hangs a shape on a door of the board (`use` marks the door used in the layout); null when not one square of it fits behind the door. */
function hang(def: DungeonDef, rooms: Room[], board: Board, parent: { room: number; r: number; c: number; side: Side }, shapeId: string, use: (rs: Room[]) => Room[]): (Placement & { fit: number }) | null {
  const shape = def.shapes.find((s) => s.id === shapeId);
  if (!shape) return null;
  const [dr, dc] = STEP[parent.side];
  const er = parent.r + dr, ec = parent.c + dc;
  const need = OPPOSITE[parent.side];
  type Way = { rot: number; x: number; y: number; door: number; fit: number; total: number };
  let best: Way | null = null;
  const orients = orientations(shape);
  const behind = er >= 0 && ec >= 0 && er < def.height && ec < def.width && !board.owner.has(key(er, ec));
  search: for (let rot = 0; rot < 4 && behind; rot++) {
    const o = orients[rot];
    // The squares the party can step into: a door on the facing side, or, in a dead end, any floor square with that side bare.
    const entries: { r: number; c: number; door: number }[] = o.open
      ? o.cells.filter(([r, c]) => !o.cells.some(([r2, c2]) => r2 === r + STEP[need][0] && c2 === c + STEP[need][1])).map(([r, c]) => ({ r, c, door: -1 }))
      : o.doors.map((d, door) => ({ r: d.r, c: d.c, side: d.side, door })).filter((d) => d.side === need);
    for (const e of entries) {
      const x = ec - e.c, y = er - e.r;
      let fit = 0;
      for (const [r, c] of o.cells) {
        const ar = y + r, ac = x + c;
        if (ar >= 0 && ac >= 0 && ar < def.height && ac < def.width && !board.owner.has(key(ar, ac))) fit++;
      }
      if (fit === 0) continue;
      const way: Way = { rot, x, y, door: e.door, fit, total: o.cells.length };
      // The first way that fits whole wins; otherwise the one that keeps the most squares.
      if (fit === o.cells.length) {
        best = way;
        break search;
      }
      if (best === null || fit > best.fit) best = way;
    }
  }
  if (!best) return null;
  let stretch = 0;
  // A corridor that fits but leads nowhere (all its other doors against a wall or the edge) may be lengthened.
  if (def.stretch && isCorridor(shape) && best.fit === best.total && opensOnto(def, board, orients[best.rot], best) === 0 && orients[best.rot].doors.length > 1) {
    for (let k = 1; k <= def.stretch && stretch === 0; k++) {
      const longer = stretchedShape(shape, k);
      if (longer === shape) break;
      const way = bestWay(def, board, orientations(longer), er, ec, need, true);
      if (way && opensOnto(def, board, orientations(longer)[way.rot], way) > 0) {
        best = way;
        stretch = k;
      }
    }
  }
  const next: Room[] = [...use(rooms), { shape: shape.id, ...(stretch > 0 ? { stretch } : {}), x: best.x, y: best.y, rot: best.rot, used: best.door >= 0 ? [best.door] : [], mark: "" }];
  return { layout: formatLayout(next), room: next.length, truncated: best.fit < best.total, fit: best.fit };
}

/** The first way a turned shape fits whole behind the square (er, ec) with a door onto empty sheet (when `doors`), else null. */
function bestWay(def: DungeonDef, board: Board, orients: Oriented[], er: number, ec: number, need: Side, doors: boolean): { rot: number; x: number; y: number; door: number; fit: number; total: number } | null {
  for (let rot = 0; rot < 4; rot++) {
    const o = orients[rot];
    for (const [door, d] of o.doors.entries()) {
      if (d.side !== need) continue;
      const x = ec - d.c, y = er - d.r;
      const whole = o.cells.every(([r, c]) => {
        const ar = y + r, ac = x + c;
        return ar >= 0 && ac >= 0 && ar < def.height && ac < def.width && !board.owner.has(key(ar, ac));
      });
      if (!whole) continue;
      const way = { rot, x, y, door, fit: o.cells.length, total: o.cells.length };
      if (!doors || opensOnto(def, board, o, way) > 0) return way;
    }
  }
  return null;
}

/** How many of a placed shape's doors, other than the one entered by, open onto empty sheet. */
function opensOnto(def: DungeonDef, board: Board, o: Oriented, way: { x: number; y: number; door: number }): number {
  const own = new Set(o.cells.map(([r, c]) => key(way.y + r, way.x + c)));
  return o.doors.filter((d, i) => {
    if (i === way.door) return false;
    const [dr, dc] = STEP[d.side];
    const er = way.y + d.r + dr, ec = way.x + d.c + dc;
    return er >= 0 && ec >= 0 && er < def.height && ec < def.width && !board.owner.has(key(er, ec)) && !own.has(key(er, ec));
  }).length;
}

/** Which rooms are joined: through a used door, the room on the other side of it. */
export function linksOf(board: Board): Map<number, Set<number>> {
  const links = new Map<number, Set<number>>(board.rooms.map((p) => [p.n, new Set<number>()]));
  for (const p of board.rooms) {
    for (const d of p.doors) {
      if (d.state !== "used") continue;
      const [dr, dc] = STEP[d.side];
      const other = board.owner.get(key(d.r + dr, d.c + dc));
      if (other === undefined || other === p.n) continue;
      links.get(p.n)?.add(other);
      links.get(other)?.add(p.n);
    }
  }
  return links;
}

/** Rooms from `from` by the fewest doors (breadth first), each with its distance; `from` itself at 0. */
function distances(board: Board, from: number): Map<number, number> {
  const links = linksOf(board);
  const dist = new Map<number, number>();
  if (!links.has(from)) return dist;
  dist.set(from, 0);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const next of [...(links.get(at) ?? [])].sort((a, b) => a - b)) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(at)! + 1);
      queue.push(next);
    }
  }
  return dist;
}

/** The rooms walked into going from `from` to `to` by the shortest way, in order (ending with `to`); empty when it is the same room or there is no way. */
export function wayBetween(board: Board, from: number, to: number): number[] {
  const links = linksOf(board);
  if (!links.has(from) || !links.has(to) || from === to) return [];
  const before = new Map<number, number>([[from, 0]]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (at === to) break;
    for (const next of [...(links.get(at) ?? [])].sort((a, b) => a - b)) {
      if (before.has(next)) continue;
      before.set(next, at);
      queue.push(next);
    }
  }
  if (!before.has(to)) return [];
  const way: number[] = [];
  for (let at = to; at !== from; at = before.get(at)!) way.unshift(at);
  return way;
}

/**
 * Notes kept per room, for what the layout does not hold (who lives there, what was left behind):
 * one string `room.field=value` entries joined by `;`. A value that reads as a whole number comes
 * back as a number, anything else as text; a missing one as "".
 */
export function noteGet(notes: string, room: number, field: string): string | number {
  const key = `${room}.${field}=`;
  const entry = String(notes ?? "").split(";").find((e) => e.startsWith(key));
  if (entry === undefined) return "";
  const value = entry.slice(key.length);
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

/** Sets (or, with an empty value, removes) a room's note; `;` and `=` in the value are dropped. */
export function noteSet(notes: string, room: number, field: string, value: string | number): string {
  const key = `${room}.${field.replace(/[;=]/g, "")}=`;
  const kept = String(notes ?? "").split(";").filter((e) => e !== "" && !e.startsWith(key));
  const text = String(value ?? "").replace(/[;=]/g, "");
  if (text !== "") kept.push(key + text);
  return kept.join(";");
}

/** How many rooms the party walks into going from `from` to `to` by the shortest way (0 when it is the same room; -1 when there is no way). */
export function stepsBetween(board: Board, from: number, to: number): number {
  return distances(board, from).get(to) ?? -1;
}

/** The nearest room (fewest doors from `from`, then lowest number) that still has a free door; 0 when none has. */
export function nearestFreeRoom(board: Board, from: number): number {
  const withDoors = new Set(freeDoors(board).map((d) => d.room));
  const found = [...distances(board, from)].filter(([n]) => withDoors.has(n)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return found[0]?.[0] ?? 0;
}

/** Writes a note on a room (a symbol or a word, `;` and `:` dropped); the layout comes back unchanged when the room does not exist. */
export function markRoom(layout: string, room: number, text: string): string {
  const rooms = parseLayout(layout);
  if (room < 1 || room > rooms.length) return layout;
  rooms[room - 1] = { ...rooms[room - 1], mark: text };
  return formatLayout(rooms);
}

/** The part of the sheet that is worth drawing: the rooms' bounding box with a margin, in squares. */
export function viewBox(board: Board, margin = 1): { x: number; y: number; w: number; h: number } {
  const all = board.rooms.flatMap((p) => p.cells);
  if (all.length === 0) return { x: 0, y: 0, w: Math.min(board.width, 6), h: Math.min(board.height, 4) };
  const r0 = Math.max(0, Math.min(...all.map((c) => c[0])) - margin), r1 = Math.min(board.height, Math.max(...all.map((c) => c[0])) + 1 + margin);
  const c0 = Math.max(0, Math.min(...all.map((c) => c[1])) - margin), c1 = Math.min(board.width, Math.max(...all.map((c) => c[1])) + 1 + margin);
  return { x: c0, y: r0, w: c1 - c0, h: r1 - r0 };
}

/**
 * The shapes in a note: each `### <id> …` heading starts one (a row of `###` squares has no space after it, so it is no heading), and its first fenced block holds the
 * squares (`#` floor, `.` empty) followed by optional lines `doors: top:1 right:2`, `entry: bottom:2`
 * and `kind: corridor`. Everything else in the note is for the reader.
 */
export function shapesFromMarkdown(md: string): ShapeDef[] {
  const out: ShapeDef[] = [];
  for (const section of md.split(/^###[ \t]+(?=\S)/m).slice(1)) {
    const id = /^(\S+)/.exec(section)?.[1];
    const block = /```[^\n]*\n([\s\S]*?)```/.exec(section)?.[1];
    if (!id || block === undefined) continue;
    const shape: ShapeDef = { id, cells: [] };
    for (const raw of block.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "") continue;
      const m = /^(doors|门|entry|入口|kind|类型)\s*[:：]\s*(.*)$/i.exec(line);
      if (!m) {
        shape.cells.push(line.replace(/\s+/g, ""));
        continue;
      }
      const key = m[1].toLowerCase();
      if (key === "doors" || key === "门") shape.doors = m[2].split(/[\s,，]+/).filter((d) => d !== "");
      else if (key === "entry" || key === "入口") shape.entry = m[2].trim();
      else if (/^(corridor|走廊)$/i.test(m[2].trim())) shape.kind = "corridor";
      else if (/^(room|房间)$/i.test(m[2].trim())) shape.kind = "room";
    }
    out.push(shape);
  }
  return out;
}

/** A wall segment on the lines between squares: (r1, c1) to (r2, c2) in grid coordinates. */
export type Wall = [number, number, number, number];

/** The walls to draw: every square edge that does not touch another square of the same room, except where a door is. */
export function wallsOf(board: Board): Wall[] {
  const doorEdges = new Set(board.rooms.flatMap((p) => p.doors.filter((d) => d.state !== "blocked").map((d) => `${d.r},${d.c},${d.side}`)));
  const seen = new Set<string>();
  const walls: Wall[] = [];
  for (const p of board.rooms) {
    for (const [r, c] of p.cells) {
      for (const side of SIDES) {
        const [dr, dc] = STEP[side];
        if (board.owner.get(key(r + dr, c + dc)) === p.n) continue;
        if (doorEdges.has(`${r},${c},${side}`)) continue;
        const seg: Wall = side === "top" ? [r, c, r, c + 1] : side === "bottom" ? [r + 1, c, r + 1, c + 1] : side === "left" ? [r, c, r + 1, c] : [r, c + 1, r + 1, c + 1];
        const id = seg.join(",");
        if (seen.has(id)) continue;
        seen.add(id);
        walls.push(seg);
      }
    }
  }
  return walls;
}
