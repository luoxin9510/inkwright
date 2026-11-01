import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { cardFromNote, resolveDecks, type CardNote } from "../src/game/cards";
import { numberFields, readCard, readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { PlaySession } from "../src/play/session";
import { CONFIG } from "./fixtures/gameConfig";

const note = (name: string, frontmatter: Record<string, unknown> | undefined, body = ""): CardNote => ({ path: `牌/手段/${name}.md`, name, frontmatter, body });

describe("cards with numbers and art", () => {
  test("numbers in a card entry become attrs, nested ones flattened; image links are cleaned", () => {
    expect(numberFields({ cost: 2, icons: { combat: 1, agility: 0 }, name: "x", ok: true, tags: [1] }, ["name"])).toEqual({ cost: 2, icons_combat: 1, icons_agility: 0 });
    expect(readCard({ id: "torch", name: { zh: "手电" }, cost: 1, image: "![[art/torch.png|200]]" }, "torch")).toEqual({ id: "torch", name: { zh: "手电" }, image: "art/torch.png", attrs: { cost: 1 } });
    const read = readConfig({ rules: { kind: "sum", dice: [6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], decks: [{ id: "d", cards: [{ id: "a", cost: 2, icons: { combat: 1 } }] }], attributes: { cost: { zh: "费用", en: "Cost" } } });
    expect(read.problems).toEqual([]);
    expect(read.config?.decks?.[0].cards[0]).toEqual({ id: "a", attrs: { cost: 2, icons_combat: 1 } });
    expect(read.config?.attributes).toEqual({ cost: { zh: "费用", en: "Cost" } });
    expect(validateConfig({ ...CONFIG, decks: [{ id: "d", cards: [{ id: "a", attrs: { "bad key": 1 } }] }] })).toContainEqual({ code: "cardAttr", args: ["a", "bad key"] });
  });

  test("the generated ink has a function per attribute key, 0 for a card without it", () => {
    const config: GameConfig = { ...CONFIG, decks: [{ id: "d", cards: [{ id: "a", attrs: { cost: 2, icons_combat: 1 } }, { id: "b", attrs: { cost: 3 } }] }] };
    const ink = generateInk(config);
    expect(ink).toContain("=== function 牌_cost(哪张) ===\n{ 哪张 == a:\n    ~ return 2\n}\n{ 哪张 == b:\n    ~ return 3\n}\n~ return 0");
    expect(ink).toContain("=== function 牌_icons_combat(哪张) ===\n{ 哪张 == a:\n    ~ return 1\n}\n~ return 0");
    const story = new Compiler(`-> main\n${ink}\n=== main ===\n{牌_cost(a)} {牌_cost(b)} {牌_icons_combat(b)}\n-> END\n`).Compile();
    const session = new PlaySession(story);
    expect(session.start().paragraphs[0].text).toBe("2 3 0");
  });

  test("the engine names a card's numbers for the player and carries its art", () => {
    const config: GameConfig = { ...CONFIG, attributes: { cost: { zh: "费用", en: "Cost" } }, decks: [{ id: "d", cards: [{ id: "a", name: { zh: "甲", en: "A" }, image: "art/a.png", attrs: { cost: 2, icons_combat: 1 } }] }], hands: [{ id: "h" }] };
    const engine = new GameEngine(config);
    const session = new PlaySession(new Compiler(`-> main\n${generateInk(config)}\n=== main ===\n~ h += 抽牌("d")\nx\n-> END\n`).Compile(), { setup: (s) => engine.setup(s, "昕") });
    session.start();
    expect(engine.hud().hands?.[0].cards[0]).toEqual({ id: "a", name: "甲", deck: "d", deckName: "d", image: "art/a.png", attrs: [{ key: "cost", name: "费用", value: 2 }, { key: "icons_combat", name: "icons_combat", value: 1 }] });
    engine.language = "en";
    expect(engine.hud().hands?.[0].cards[0].attrs?.[0]).toEqual({ key: "cost", name: "Cost", value: 2 });
  });
});

describe("decks from a folder of notes", () => {
  test("a note becomes a card: id from the frontmatter or the file name, desc from the body", () => {
    expect(cardFromNote(note("手电", { name: { zh: "手电", en: "Torch" }, cost: 1, image: "[[torch.png]]" }, "照过去。\n"))).toEqual({ id: "手电", name: { zh: "手电", en: "Torch" }, desc: "照过去。", image: "torch.png", attrs: { cost: 1 } });
    expect(cardFromNote(note("Open the door", { id: "door", desc: { zh: "开门", en: "Open" } }, "ignored when desc is given"))).toEqual({ id: "door", name: "Open the door", desc: { zh: "开门", en: "Open" } });
    expect(cardFromNote(note("x", undefined))).toEqual({ id: "x", name: "x" });
  });

  test("resolveDecks fills a deck from its folder, sorted by name, and reports a missing folder or a bad id", async () => {
    const config: GameConfig = { ...CONFIG, decks: [{ id: "tricks", cards: [], from: "牌/手段/" }, { id: "fixed", cards: [{ id: "k" }] }] };
    const folders: Record<string, CardNote[]> = { "games/x/牌/手段": [note("口哨", { cost: 2 }), note("手电", { cost: 1 }, "照过去。")] };
    const r = await resolveDecks(config, async (f) => folders[f] ?? null, "games/x/");
    expect(r.problems).toEqual([]);
    expect(r.files).toEqual(["牌/手段/口哨.md", "牌/手段/手电.md"]);
    expect(r.config.decks?.[0]).toEqual({ id: "tricks", from: undefined, cards: [{ id: "口哨", name: "口哨", attrs: { cost: 2 } }, { id: "手电", name: "手电", desc: "照过去。", attrs: { cost: 1 } }] });
    expect(r.config.decks?.[1]).toEqual({ id: "fixed", cards: [{ id: "k" }] });
    expect(generateInk(r.config)).toContain("LIST tricks = 口哨, 手电");
    const missing = await resolveDecks(config, async () => null, "");
    expect(missing.problems).toEqual([{ code: "deckFolder", args: ["tricks", "牌/手段/"] }]);
    expect(missing.config.decks?.[0].cards).toEqual([]);
    const bad = await resolveDecks(config, async () => [note("open door", { cost: 1 })], "games/x/");
    expect(bad.problems).toContainEqual({ code: "ident", args: ["open door"] });
    const dup = await resolveDecks(config, async () => [note("k", {})], "games/x/");
    expect(dup.problems).toContainEqual({ code: "duplicate", args: ["k"] });
  });

  test("a deck with from: needs no cards in the note", () => {
    const read = readConfig({ rules: { kind: "sum", dice: [6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], decks: [{ id: "d", from: "牌/" }] });
    expect(read.problems).toEqual([]);
    expect(read.config?.decks?.[0]).toEqual({ id: "d", from: "牌/", cards: [] });
  });
});
