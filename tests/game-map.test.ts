import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

const MAP: GameConfig = {
  ...CONFIG,
  map: {
    image: "地图.svg", width: 400, height: 300,
    places: [
      { id: "门厅", name: { zh: "门厅", en: "Hall" }, x: 100, y: 150, links: ["书房", "地窖"] },
      { id: "书房", name: { zh: "书房", en: "Study" }, x: 300, y: 80, links: ["门厅"], counter: "线索_书房", counterName: { zh: "线索", en: "Clues" } },
      { id: "地窖", name: { zh: "地窖", en: "Cellar" }, x: 300, y: 250, hidden: true, links: ["门厅"] },
    ],
    tokens: [{ id: "食尸鬼", name: { zh: "食尸鬼", en: "Ghoul" }, color: "#c33", at: "地窖" }],
  },
};

const STORY = `-> main
${generateInk(MAP)}
VAR 线索_书房 = 2
=== main ===
在 {所在}。
+ [去书房 #go:书房]
    ~ 所在 = 书房
    ~ 线索_书房 -= 1
    -> main
+ [下地窖 #go:地窖]
    ~ 已揭示 += 地窖
    ~ 所在 = 地窖
    ~ 食尸鬼_在 = ()
    -> main
+ [走]
    -> END
`;

describe("map", () => {
  test("the config reads the map and checks its places, links and tokens", () => {
    const base = { rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }] };
    const ok = readConfig({ ...base, map: { width: 10, height: 10, places: [{ id: "a", x: 1, y: 2, links: ["b"] }, { id: "b", x: 3, y: 4, hidden: true }], tokens: [{ id: "tok", at: "a" }] } });
    expect(ok.problems).toEqual([]);
    expect(ok.config?.map?.places[1]).toEqual({ id: "b", x: 3, y: 4, hidden: true });
    expect(readConfig({ ...base, map: { places: [{ id: "a", x: 1 }] } }).problems).toEqual([{ code: "shape", args: ["map"] }]);
    expect(validateConfig({ ...MAP, map: { places: [] } })).toContainEqual({ code: "mapPlaces", args: [] });
    expect(validateConfig({ ...MAP, map: { places: [{ id: "a", x: 0, y: 0, links: ["b"] }] } })).toContainEqual({ code: "mapLink", args: ["a", "b"] });
    expect(validateConfig({ ...MAP, map: { places: [{ id: "a", x: 0, y: 0 }], tokens: [{ id: "t", at: "b" }] } })).toContainEqual({ code: "mapPlace", args: ["t", "b"] });
    // Places and tokens share the id namespace; a token's place VAR counts too.
    expect(validateConfig({ ...MAP, map: { places: [{ id: "力量", x: 0, y: 0 }] } })).toContainEqual({ code: "duplicate", args: ["力量"] });
    expect(validateConfig({ ...MAP, map: { places: [{ id: "a", x: 0, y: 0 }], tokens: [{ id: "a" }] } })).toContainEqual({ code: "duplicate", args: ["a"] });
    // The map's generated names are reserved only for games with a map.
    const withHere = { ...CONFIG, resources: [...CONFIG.resources, { id: "所在", min: 0, max: 1, initial: 0 }] };
    expect(validateConfig(withHere)).toEqual([]);
    expect(validateConfig({ ...withHere, map: MAP.map })).toContainEqual({ code: "duplicate", args: ["所在"] });
  });

  test("a place is tappable only for a choice that can be taken now, and never for one that also plays a card", () => {
    const config: GameConfig = { ...MAP, hands: [{ id: "手牌" }], decks: [{ id: "牌", cards: [{ id: "x" }] }] };
    const story = `-> main
${generateInk(config)}
=== main ===
门厅。
+ [捅 #go:书房 #needs:刀]
    -> main
+ [出牌 #go:书房 #play:手牌]
    -> main
+ [去 #go:书房]
    -> main
`;
    const engine = new GameEngine(config);
    const session = new PlaySession(new Compiler(story).Compile(), { setup: (s) => engine.setup(s, "昕") });
    const step = session.start();
    expect(engine.map(step.choices)?.places[1].go).toBe(2);
  });

  test("the generated ink declares the places, where the player is, what is revealed and each token's place", () => {
    const ink = generateInk(MAP);
    expect(ink).toContain("LIST 地点 = 门厅, 书房, 地窖\nVAR 所在 = (门厅)\nVAR 已揭示 = (门厅, 书房)\nVAR 食尸鬼_在 = (地窖)");
    expect(generateInk({ ...MAP, map: { places: [{ id: "a", x: 0, y: 0, hidden: true }], tokens: [{ id: "t" }] } })).toContain("LIST 地点 = a\nVAR 所在 = ()\nVAR 已揭示 = ()\nVAR t_在 = ()");
    expect(generateInk(CONFIG)).not.toContain("LIST 地点");
  });

  test("the engine reads the map from the state: the player's place, revealed places, counters, tokens and the choices that go somewhere", () => {
    const engine = new GameEngine(MAP);
    const session = new PlaySession(new Compiler(STORY).Compile(), { setup: (s) => engine.setup(s, "昕") });
    let step = session.start();
    expect(engine.goOf(step.choices[0])).toBe("书房");
    expect(engine.goOf(step.choices[2])).toBeNull();
    const map = engine.map(step.choices);
    expect(map).toMatchObject({ image: "地图.svg", width: 400, height: 300 });
    expect(map?.places).toEqual([
      { id: "门厅", name: "门厅", x: 100, y: 150, links: ["书房", "地窖"], revealed: true, here: true },
      { id: "书房", name: "书房", x: 300, y: 80, links: ["门厅"], revealed: true, here: false, counter: { name: "线索", value: 2 }, go: 0 },
      { id: "地窖", name: "地窖", x: 300, y: 250, links: ["门厅"], revealed: false, here: false, go: 1 },
    ]);
    expect(map?.tokens).toEqual([{ id: "食尸鬼", name: "食尸鬼", color: "#c33", at: "地窖" }]);
    step = session.choose(0);
    expect(engine.map(step.choices)?.places.map((p) => [p.here, p.counter?.value])).toEqual([[false, undefined], [true, 1], [false, undefined]]);
    step = session.choose(1);
    const after = engine.map(step.choices);
    expect(after?.places[2]).toMatchObject({ revealed: true, here: true });
    expect(after?.tokens[0].at).toBeNull();
    session.back();
    expect(engine.map()?.places[2].revealed).toBe(false);
    engine.language = "en";
    expect(engine.map()?.places.map((p) => p.name)).toEqual(["Hall", "Study", "Cellar"]);
    expect(engine.map()?.places[1].counter?.name).toBe("Clues");
    expect(new GameEngine(CONFIG).map()).toBeNull();
  });

  test("a map without a size uses percentages", () => {
    const engine = new GameEngine({ ...MAP, map: { places: [{ id: "a", x: 50, y: 50 }] } });
    engine.setup(new Compiler(`-> END\n${generateInk({ ...MAP, map: { places: [{ id: "a", x: 50, y: 50 }] } })}`).Compile(), "昕");
    expect(engine.map()).toMatchObject({ width: 100, height: 100 });
  });
});
