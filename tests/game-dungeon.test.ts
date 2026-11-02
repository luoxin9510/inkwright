import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { shapesFromMarkdown } from "../src/game/dungeon";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { resolveDungeon } from "../src/game/resolve";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

const SHAPES = [
  { id: "gate", name: { zh: "门厅", en: "Gate" }, cells: ["###", "###"], doors: ["top:1", "top:3"], entry: "bottom:2" },
  { id: "corridor", cells: ["#", "#", "#"], doors: ["top:1", "bottom:1"] },
  { id: "hall", cells: ["###", "###", "###"], doors: ["bottom:2", "top:2", "right:2"] },
];
const GAME: GameConfig = { ...CONFIG, languages: ["zh", "en"], dungeon: { width: 9, height: 10, shapes: SHAPES } };

const STORY = `-> main
${generateInk(GAME)}
=== main ===
~ temp first = 开地城("gate")
入口是 {地城_形状(地城, 1)},余门 {地城_余门(地城, 0)}。
+ [接走廊]
    ~ temp r = 接房间("corridor", 1, 1)
    ~ 所在房间 = r
    ~ 标记房间(r, "⚔")
    房间 {r}:{地城_走廊(地城, r)},余门 {地城_余门(地城, 0)}。
    -> main2
=== main2 ===
+ [接大厅]
    ~ temp r = 接房间("hall", 所在房间, 1)
    ~ 所在房间 = r
    大厅 {r},共 {地城_房数(地城)} 间,余门 {地城_余门(地城, 0)}。
    -> END
`;

describe("the growing dungeon in a story", () => {
  test("the config reads and validates; a bad shape or size is reported", () => {
    const ok = readConfig({ rules: { kind: "sum", dice: [6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], dungeon: { width: 9, height: 10, shapes: SHAPES } });
    expect(ok.problems).toEqual([]);
    expect(ok.config?.dungeon?.shapes).toHaveLength(3);
    expect(validateConfig({ ...GAME, dungeon: { width: 2, height: 10, shapes: SHAPES } })).toEqual([{ code: "dungeonSize", args: [] }]);
    expect(validateConfig({ ...GAME, dungeon: { width: 9, height: 10, shapes: [SHAPES[0], { id: "gate", cells: ["#"] }, { id: "x", cells: ["#"], doors: ["top:3"] }] } }))
      .toEqual([{ code: "duplicate", args: ["gate"] }, { code: "dungeonShape", args: ["x", 'door "top:3" is not on the floor'] }]);
    expect(readConfig({ rules: { kind: "sum", dice: [6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], dungeon: { width: 9, height: 10, shapes: [{ id: "a", cells: "###" }] } }).problems).toEqual([{ code: "shape", args: ["dungeon"] }]);
    // The generated names are reserved only when there is a dungeon.
    expect(validateConfig({ ...CONFIG, resources: [...CONFIG.resources, { id: "地城", min: 0, max: 1, initial: 0 }] }).some((p) => p.code === "duplicate")).toBe(false);
    expect(validateConfig({ ...GAME, resources: [...CONFIG.resources, { id: "地城", min: 0, max: 1, initial: 0 }] }).some((p) => p.code === "duplicate")).toBe(true);
  });

  test("begin, add, mark and count from ink; the engine draws what the layout says", () => {
    const engine = new GameEngine(GAME);
    const session = new PlaySession(new Compiler(STORY).Compile(), { setup: (s) => engine.setup(s, "昕") });
    const first = session.start();
    expect(first.paragraphs[0].text).toBe("入口是 gate,余门 2。");
    expect(engine.dungeon()).toMatchObject({ here: 1, free: 2, rooms: [{ n: 1, shape: "gate", name: "Gate".replace("Gate", "门厅"), corridor: false, here: true }] });
    const second = session.choose(0);
    expect(second.paragraphs.at(-1)?.text).toBe("房间 2:1,余门 2。");
    const view = engine.dungeon()!;
    expect(view.rooms.map((r) => [r.n, r.shape, r.mark, r.here])).toEqual([[1, "gate", "", false], [2, "corridor", "⚔", true]]);
    expect(view.rooms[1].doors.map((d) => d.state)).toEqual(["free", "used"]);
    expect(view.walls.length).toBeGreaterThan(8);
    expect(view.box.w).toBeLessThanOrEqual(9);
    const third = session.choose(0);
    expect(third.paragraphs.at(-1)?.text).toBe("大厅 3,共 3 间,余门 3。");
    // English names follow the engine's language.
    engine.language = "en";
    expect(engine.dungeon()?.rooms[0].name).toBe("Gate");
  });

  test("back, save and load keep the layout: it is a variable", () => {
    const engine = new GameEngine(GAME);
    const session = new PlaySession(new Compiler(STORY).Compile(), { setup: (s) => engine.setup(s, "昕") });
    session.start();
    session.choose(0);
    session.back();
    expect(engine.dungeon()?.rooms).toHaveLength(1);
    session.choose(0);
    const saved = session.save();
    const other = new GameEngine(GAME);
    const s2 = new PlaySession(new Compiler(STORY).Compile(), { setup: (s) => other.setup(s, "昕") });
    s2.load(saved!);
    expect(other.dungeon()?.rooms).toHaveLength(2);
  });

  test("without the engine nothing grows and the story still runs", () => {
    const session = new PlaySession(new Compiler(STORY).Compile());
    expect(session.start().paragraphs[0].text).toBe("入口是 ,余门 0。");
  });
});

describe("shapes kept in a note", () => {
  const NOTE = `# Shapes

### r11 a hall
Some prose the reader sees.

\`\`\`
##.
###
doors: top:1 right:2
entry: bottom:2
kind: room
\`\`\`

### r12
\`\`\`
#
#
门: top:1 bottom:1
\`\`\`

### broken
no block here
`;

  test("kind accepts the word alone, in either language, and nothing longer", () => {
    const one = (kind: string) => shapesFromMarkdown(`### a\n\`\`\`\n##\nkind: ${kind}\n\`\`\`\n`)[0].kind;
    expect([one("corridor"), one("走廊"), one("room"), one("房间"), one("corridors"), one("my room"), one("走廊口")]).toEqual(["corridor", "corridor", "room", "room", undefined, undefined, undefined]);
  });

  test("a heading and a fenced block make a shape", () => {
    expect(shapesFromMarkdown(NOTE)).toEqual([
      { id: "r11", cells: ["##.", "###"], doors: ["top:1", "right:2"], entry: "bottom:2", kind: "room" },
      { id: "r12", cells: ["#", "#"], doors: ["top:1", "bottom:1"] },
    ]);
  });

  test("resolveDungeon adds them to the inline ones, reports a missing note and clashes", async () => {
    const config: GameConfig = { ...CONFIG, dungeon: { width: 9, height: 10, shapes: [SHAPES[0]], from: "形状.md" } };
    const r = await resolveDungeon(config, async (p) => (p === "games/x/形状.md" ? NOTE : null), "games/x/");
    expect(r.problems).toEqual([]);
    expect(r.files).toEqual(["games/x/形状.md"]);
    expect(r.config.dungeon?.shapes.map((s) => s.id)).toEqual(["gate", "r11", "r12"]);
    expect((await resolveDungeon(config, async () => null, "")).problems).toEqual([{ code: "dungeonFile", args: ["形状.md"] }]);
    const clash = await resolveDungeon({ ...config, dungeon: { ...config.dungeon!, shapes: [{ id: "r12", cells: ["#"] }] } }, async () => NOTE, "");
    expect(clash.problems).toEqual([{ code: "duplicate", args: ["r12"] }]);
  });
});

describe("secret doors and the way back, from ink", () => {
  test("开暗门 hangs a room behind a wall; 地城_步数 and 地城_最近有门 walk the links", () => {
    const story = `-> main
${generateInk(GAME)}
=== main ===
~ 开地城("gate")
~ temp a = 接房间("corridor", 1, 1)
~ temp s = 开暗门("hall", a)
暗门后是 {s},回门厅 {地城_步数(地城, s, 1)} 步,最近有门的是 {地城_最近有门(地城, s)}。
-> END
`;
    const engine = new GameEngine(GAME);
    const session = new PlaySession(new Compiler(story).Compile(), { setup: (st) => engine.setup(st, "昕") });
    expect(session.start().paragraphs[0].text).toBe("暗门后是 3,回门厅 2 步,最近有门的是 3。");
    expect(engine.dungeon()?.rooms).toHaveLength(3);
  });
});
