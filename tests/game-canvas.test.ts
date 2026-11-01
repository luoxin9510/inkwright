import { describe, expect, test } from "vitest";
import { mapFromCanvas, resolveMap } from "../src/game/canvas";
import { readConfig, type GameConfig } from "../src/game/config";
import { CONFIG } from "./fixtures/gameConfig";

const CANVAS = JSON.stringify({
  nodes: [
    { id: "img", type: "file", file: "教程/地图.svg", x: 100, y: 100, width: 400, height: 300 },
    { id: "n1", type: "text", text: "hall\n门厅,起点", x: 150, y: 230, width: 80, height: 40 },
    { id: "n2", type: "text", text: "study", x: 300, y: 150, width: 60, height: 40 },
    { id: "n3", type: "text", text: "? cellar", x: 400, y: 330, width: 80, height: 40 },
    { id: "n4", type: "text", text: "   ", x: 0, y: 0, width: 10, height: 10 },
    { id: "g", type: "group", x: 0, y: 0, width: 600, height: 500, label: "house" },
  ],
  edges: [
    { id: "e1", fromNode: "n1", toNode: "n2" },
    { id: "e2", fromNode: "n2", toNode: "n1" },
    { id: "e3", fromNode: "n1", toNode: "n3" },
    { id: "e4", fromNode: "n1", toNode: "g" },
  ],
});

describe("map from a canvas", () => {
  test("text nodes are places (first line the id, ? hidden), edges are links, the image node sets the frame", () => {
    const m = mapFromCanvas(CANVAS);
    expect(m).toEqual({
      image: "教程/地图.svg", width: 400, height: 300,
      places: [
        { id: "hall", x: 90, y: 150, links: ["study", "cellar"] },
        { id: "study", x: 230, y: 70, links: ["hall"] },
        { id: "cellar", x: 340, y: 250, hidden: true, links: ["hall"] },
      ],
    });
    expect(mapFromCanvas("not json")).toBeNull();
    expect(mapFromCanvas('{"edges":[]}')).toBeNull();
  });

  test("without an image the frame is the places' bounding box with a margin", () => {
    const m = mapFromCanvas(JSON.stringify({ nodes: [{ id: "a", type: "text", text: "a", x: 0, y: 0, width: 100, height: 50 }, { id: "b", type: "text", text: "b", x: 200, y: 100, width: 100, height: 50 }], edges: [] }));
    expect(m).toEqual({ width: 380, height: 230, places: [{ id: "a", x: 90, y: 65 }, { id: "b", x: 290, y: 165 }] });
  });

  test("resolveMap merges the note's names, counters and tokens with the canvas, and reports a place the canvas lacks", async () => {
    const read = readConfig({
      rules: { kind: "sum", dice: [6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }],
      map: { from: "地图.canvas", places: [{ id: "study", name: { zh: "书房", en: "Study" }, counter: "clues_study" }, { id: "garden", x: 10, y: 10 }, { id: "lost" }], tokens: [{ id: "ghoul", at: "cellar" }] },
    });
    expect(read.problems).toEqual([]);
    const r = await resolveMap(read.config!, async (p) => (p === "games/x/地图.canvas" ? CANVAS : null), "games/x/");
    expect(r.files).toEqual(["games/x/地图.canvas"]);
    expect(r.problems).toEqual([{ code: "mapCanvasPlace", args: ["lost", "地图.canvas"] }]);
    expect(r.config.map).toEqual({
      from: undefined, image: "教程/地图.svg", width: 400, height: 300,
      places: [
        { id: "hall", x: 90, y: 150, links: ["study", "cellar"] },
        { id: "study", name: { zh: "书房", en: "Study" }, counter: "clues_study", x: 230, y: 70, links: ["hall"], hidden: undefined },
        { id: "cellar", x: 340, y: 250, hidden: true, links: ["hall"] },
        { id: "garden", x: 10, y: 10 },
      ],
      tokens: [{ id: "ghoul", at: "cellar" }],
    });
    const missing = await resolveMap(read.config!, async () => null, "");
    expect(missing.problems).toEqual([{ code: "mapFile", args: ["地图.canvas"] }]);
    expect(missing.config.map?.places.map((p) => p.id)).toEqual(["garden"]);
    const plain: GameConfig = { ...CONFIG, map: { places: [{ id: "a", x: 1, y: 1 }] } };
    expect(await resolveMap(plain, async () => null, "")).toEqual({ config: plain, problems: [], files: [] });
  });

  test("a place listed without x/y needs a canvas", () => {
    expect(readConfig({ rules: { kind: "sum", dice: [6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], map: { places: [{ id: "a" }] } }).problems).toEqual([{ code: "shape", args: ["map"] }]);
  });
});
