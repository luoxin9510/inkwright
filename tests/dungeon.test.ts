import { describe, expect, test } from "vitest";
import { boardOf, freeDoors, formatLayout, isCorridor, markRoom, nearestFreeRoom, noteGet, noteSet, orientations, parseLayout, placeRoom, placeSecret, shapeProblem, startLayout, stepsBetween, viewBox, wayBetween, type DungeonDef, type ShapeDef } from "../src/game/dungeon";

const GATE: ShapeDef = { id: "gate", cells: ["###", "###"], doors: ["top:1", "top:3"], entry: "bottom:2" };
const CORRIDOR: ShapeDef = { id: "corridor", cells: ["#", "#", "#"], doors: ["top:1", "bottom:1"] };
const HALL: ShapeDef = { id: "hall", cells: ["###", "###", "###"], doors: ["bottom:2", "top:2", "right:2"] };
const POCKET: ShapeDef = { id: "pocket", cells: ["##", "##"] };
const HOOK: ShapeDef = { id: "hook", cells: ["##", ".#", ".#"], doors: ["left:1", "bottom:2"] };
const DEF: DungeonDef = { width: 9, height: 8, shapes: [GATE, CORRIDOR, HALL, POCKET, HOOK] };

describe("shapes", () => {
  test("doors sit on the outermost floor square of their line, and turn with the shape", () => {
    expect(shapeProblem(HOOK)).toBeNull();
    expect(shapeProblem({ id: "x", cells: ["#.#"], doors: ["top:2"] })).toMatch(/not on the floor/);
    expect(shapeProblem({ id: "x", cells: ["..."] })).toBe("no floor");
    const [o0, o1, o2] = orientations(HOOK);
    expect(o0.doors).toEqual([{ r: 0, c: 0, side: "left" }, { r: 2, c: 1, side: "bottom" }]);
    // A quarter-turn clockwise: the left edge faces up, the bottom edge faces left.
    expect([o1.h, o1.w]).toEqual([2, 3]);
    expect(o1.doors).toEqual([{ r: 0, c: 2, side: "top" }, { r: 1, c: 0, side: "left" }]);
    expect(o2.doors.map((d) => d.side).sort()).toEqual(["right", "top"]);
    expect(orientations(HOOK)[0].cells).toHaveLength(4);
  });

  test("a shape one square wide is a corridor; a 2x2 block makes it a room; kind overrides", () => {
    expect(isCorridor(CORRIDOR)).toBe(true);
    expect(isCorridor(HOOK)).toBe(true);
    expect(isCorridor(HALL)).toBe(false);
    expect(isCorridor({ id: "snake", cells: ["###", "..#", "###"] })).toBe(true);
    expect(isCorridor({ ...HALL, kind: "corridor" })).toBe(true);
  });
});

describe("the layout string", () => {
  test("round-trips, drops what it cannot read, and keeps a mark's colons out", () => {
    const rooms = parseLayout("gate:3:6:0:2:;corridor:3:3:0:1,0:⚔ bat;junk;hall:x:1:0::");
    expect(rooms).toEqual([
      { shape: "gate", x: 3, y: 6, rot: 0, used: [2], mark: "" },
      { shape: "corridor", x: 3, y: 3, rot: 0, used: [1, 0], mark: "⚔ bat" },
    ]);
    expect(formatLayout(rooms)).toBe("gate:3:6:0:2:;corridor:3:3:0:0,1:⚔ bat");
    expect(formatLayout([{ shape: "a", x: 0, y: 0, rot: 5, used: [], mark: "a:b;c" }])).toBe("a:0:0:5::a b c");
    expect(parseLayout("")).toEqual([]);
  });
});

describe("placing rooms", () => {
  const start = startLayout(DEF, "gate")!;

  test("the entrance sits at the middle of the lower edge with its entry door used", () => {
    expect(start).toBe("gate:3:6:0:2:");
    const board = boardOf(DEF, parseLayout(start));
    expect(board.rooms[0].cells).toHaveLength(6);
    expect(board.rooms[0].doors.map((d) => [d.side, d.state, d.entry])).toEqual([["top", "free", false], ["top", "free", false], ["bottom", "used", true]]);
    expect(freeDoors(board).map((d) => [d.room, d.r, d.c])).toEqual([[1, 6, 3], [1, 6, 5]]);
    expect(startLayout(DEF, "nope")).toBeNull();
  });

  test("a room is hung on a door, turned until it fits, and the door is used up", () => {
    const a = placeRoom(DEF, start, "corridor", 1, 1);
    expect(a).toEqual({ layout: "gate:3:6:1,2:;corridor:3:3:0:1:".replace("gate:3:6:1,2:", "gate:3:6:0:0,2:"), room: 2, truncated: false });
    // The corridor's far end is the next free door; a hall hangs on it, entered by its bottom door.
    const b = placeRoom(DEF, a.layout, "hall", 2, 1);
    expect(b.room).toBe(3);
    const board = boardOf(DEF, parseLayout(b.layout));
    expect(board.rooms[2].cells).toHaveLength(9);
    expect(board.rooms.map((r) => r.corridor)).toEqual([false, true, false]);
    // No overlaps: every square has one owner.
    expect(new Set(board.rooms.flatMap((r) => r.cells.map(([r0, c]) => `${r0},${c}`))).size).toBe(6 + 3 + 9);
    // The hall sits against the top of the sheet: its top door has nothing outside it, so only the right one is left.
    expect(board.rooms[2].doors.map((d) => [d.side, d.state])).toEqual([["top", "blocked"], ["right", "free"], ["bottom", "used"]]);
    expect(freeDoors(board, 3).map((d) => d.side)).toEqual(["right"]);
  });

  test("k picks the door in the room, from 0 any room; no free door, no room", () => {
    const second = placeRoom(DEF, start, "corridor", 1, 2);
    expect(boardOf(DEF, parseLayout(second.layout)).rooms[1].cells[0][1]).toBe(5);
    const anywhere = placeRoom(DEF, start, "corridor", 0, 1);
    expect(boardOf(DEF, parseLayout(anywhere.layout)).rooms[1].cells[0][1]).toBe(3);
    expect(placeRoom(DEF, start, "corridor", 1, 9)).toEqual({ layout: start, room: 0, truncated: false });
    expect(placeRoom(DEF, start, "nope", 1, 1).room).toBe(0);
  });

  test("a dead end without doors is entered from whichever side it meets", () => {
    const a = placeRoom(DEF, start, "pocket", 1, 1);
    expect(a.room).toBe(2);
    const board = boardOf(DEF, parseLayout(a.layout));
    expect(board.rooms[1].doors).toEqual([]);
    expect(board.rooms[1].cells).toHaveLength(4);
    // Entered from the gate's door at (6,3): the pocket's bottom row sits right above it.
    expect(board.rooms[1].cells.some(([r, c]) => r === 5 && c === 3)).toBe(true);
  });

  test("a room that will not fit is cut off at the sheet's edge and still counts; a door into a wall is only used up", () => {
    const tight: DungeonDef = { ...DEF, height: 4 };
    const s = startLayout(tight, "gate")!; // rows 2-3, the hall would need rows -1..1
    const cut = placeRoom(tight, s, "hall", 1, 1);
    expect(cut.room).toBe(2);
    expect(cut.truncated).toBe(true);
    const board = boardOf(tight, parseLayout(cut.layout));
    expect(board.rooms[1].truncated).toBe(true);
    expect(board.rooms[1].cells.length).toBeLessThan(9);
    expect(board.rooms[1].cells.length).toBeGreaterThan(0);
    // A door whose outside is the edge of the sheet is no door at all.
    const edge = boardOf({ ...DEF, height: 2 }, parseLayout("gate:3:0:0:2:"));
    expect(edge.rooms[0].doors.map((d) => d.state)).toEqual(["blocked", "blocked", "used"]);
    expect(placeRoom({ ...DEF, height: 2 }, "gate:3:0:0:2:", "hall", 0, 1)).toEqual({ layout: "gate:3:0:0:2:", room: 0, truncated: false });
  });

  test("a dungeon fills up: free doors run out", () => {
    let layout = start;
    for (let i = 0; i < 40; i++) {
      const left = freeDoors(boardOf(DEF, parseLayout(layout)));
      if (left.length === 0) break;
      layout = placeRoom(DEF, layout, i % 2 === 0 ? "corridor" : "hall", 0, 1).layout;
    }
    const board = boardOf(DEF, parseLayout(layout));
    expect(freeDoors(board)).toEqual([]);
    expect(board.rooms.length).toBeGreaterThan(3);
    expect(new Set(board.rooms.flatMap((r) => r.cells.map(([a, b]) => `${a},${b}`))).size).toBe(board.rooms.reduce((n, r) => n + r.cells.length, 0));
  });

  test("marks and the part of the sheet worth drawing", () => {
    const a = placeRoom(DEF, start, "corridor", 1, 1).layout;
    expect(markRoom(a, 2, "☠")).toBe("gate:3:6:0:0,2:;corridor:3:3:0:1:☠");
    expect(markRoom(a, 9, "x")).toBe(a);
    const board = boardOf(DEF, parseLayout(a));
    expect(viewBox(board)).toEqual({ x: 2, y: 2, w: 5, h: 6 });
    expect(boardOf(DEF, parseLayout(markRoom(a, 2, "☠"))).rooms[1].mark).toBe("☠");
  });
});

describe("secret doors and the way through", () => {
  const DEF2: DungeonDef = { width: 9, height: 10, shapes: [
    { id: "gate", cells: ["###", "###"], doors: ["top:1", "top:3"], entry: "bottom:2" },
    { id: "corridor", cells: ["#", "#", "#"], doors: ["top:1", "bottom:1"] },
    { id: "box", cells: ["##", "##"] },
  ] };
  test("a secret door is a new used door on a wall; the room behind it is linked and counted in steps", () => {
    const a = placeRoom(DEF2, startLayout(DEF2, "gate")!, "corridor", 1, 1);
    const s = placeSecret(DEF2, a.layout, "box", 2);
    expect(s.room).toBe(3);
    const rooms = parseLayout(s.layout);
    expect(rooms[1].extra).toHaveLength(1);
    expect(parseLayout(formatLayout(rooms))).toEqual(rooms);
    const board = boardOf(DEF2, rooms);
    const secret = board.rooms[1].doors.find((d) => d.index < 0);
    expect(secret?.state).toBe("used");
    expect(stepsBetween(board, 3, 1)).toBe(2);
    expect(stepsBetween(board, 1, 1)).toBe(0);
    expect(stepsBetween(board, 3, 9)).toBe(-1);
    // Room 1 still has its other top door; the corridor's far end is free too, and nearer to room 3.
    expect(nearestFreeRoom(board, 3)).toBe(2);
    expect(nearestFreeRoom(board, 1)).toBe(1);
    // A room with no wall facing empty sheet gets nothing.
    expect(placeSecret(DEF2, s.layout, "box", 9).room).toBe(0);
    expect(placeSecret(DEF2, s.layout, "nope", 1)).toEqual({ layout: s.layout, room: 0, truncated: false });
  });

  test("the way between rooms lists the rooms walked into, in order", () => {
    const a = placeRoom(DEF2, startLayout(DEF2, "gate")!, "corridor", 1, 1);
    const s = placeSecret(DEF2, a.layout, "box", 2);
    const board = boardOf(DEF2, parseLayout(s.layout));
    expect(wayBetween(board, 3, 1)).toEqual([2, 1]);
    expect(wayBetween(board, 1, 3)).toEqual([2, 3]);
    expect(wayBetween(board, 2, 2)).toEqual([]);
    expect(wayBetween(board, 1, 9)).toEqual([]);
  });

  test("room notes: set, read back as numbers or text, overwrite, remove", () => {
    let notes = noteSet("", 3, "foe", "goblins");
    notes = noteSet(notes, 3, "n", 5);
    notes = noteSet(notes, 7, "foe", "ogre;=x");
    expect(noteGet(notes, 3, "foe")).toBe("goblins");
    expect(noteGet(notes, 3, "n")).toBe(5);
    expect(noteGet(notes, 7, "foe")).toBe("ogrex");
    expect(noteGet(notes, 4, "foe")).toBe("");
    notes = noteSet(notes, 3, "n", 2);
    expect(noteGet(notes, 3, "n")).toBe(2);
    notes = noteSet(notes, 3, "foe", "");
    expect(noteGet(notes, 3, "foe")).toBe("");
    expect(notes).toBe("7.foe=ogrex;3.n=2");
    // "13.n" is not "3.n".
    expect(noteGet(noteSet("", 13, "n", 1), 3, "n")).toBe("");
  });

  test("old layouts without secret doors read the same", () => {
    expect(parseLayout("gate:3:8:0:0,2:x")).toEqual([{ shape: "gate", x: 3, y: 8, rot: 0, used: [0, 2], mark: "x" }]);
  });
});
