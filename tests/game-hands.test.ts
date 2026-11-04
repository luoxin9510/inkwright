import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { compileStory } from "../src/compile/compile";
import { parsePlayTag, readConfig, validateConfig, type GameConfig } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { exploreStory } from "../src/play/explore";
import { PlaySession } from "../src/play/session";
import { simulateStory } from "../src/play/simulate";
import { CONFIG } from "./fixtures/gameConfig";

const HANDS: GameConfig = {
  ...CONFIG,
  decks: [{
    id: "线索", name: { zh: "线索", en: "Clues" },
    cards: [
      { id: "血手印", name: { zh: "血手印", en: "Bloody handprint" }, desc: { zh: "门把手上。", en: "On the door handle." } },
      { id: "半张票", name: { zh: "半张票", en: "Half a ticket" } },
      { id: "钥匙扣", name: { zh: "钥匙扣", en: "Key ring" } },
    ],
  }],
  hands: [{ id: "手牌", name: { zh: "手牌", en: "Hand" } }],
};

/** Draws every card into the hand, then plays them one by one; `#play` carries the card. */
const STORY = (tag = "#play:手牌") => `-> main
${generateInk(HANDS)}
=== main ===
~ 手牌 += 抽牌("线索")
~ 手牌 += 抽牌("线索")
~ 手牌 += 抽牌("线索")
桌上。
-> turn
=== turn ===
{ LIST_COUNT(手牌) == 0: -> END }
+ [打出一张 ${tag}]
    ~ 手牌 -= 出牌
    { 出牌 == 血手印: 血。 }
    { 出牌 == 半张票: 票。 }
    { 出牌 == 钥匙扣: 扣。 }
    -> turn
+ [走]
    走了。
    -> END
`;

/** rng that makes the dice show the given faces, then repeats the last one. */
const faces = (...fs: number[]) => {
  let i = 0;
  return () => (fs[Math.min(i++, fs.length - 1)] - 1) / 6 + 1e-9;
};

const played = (card: string) => ({ var: "出牌", item: card });

describe("hands", () => {
  test("the config reads hands, whose ids share the namespace with decks and cards", () => {
    const { config, problems } = readConfig({ rules: { kind: "sum", dice: [6, 6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], hands: [{ id: "hand", name: { zh: "手牌", en: "Hand" } }] });
    expect(problems).toEqual([]);
    expect(config?.hands).toEqual([{ id: "hand", name: { zh: "手牌", en: "Hand" } }]);
    expect(readConfig({ rules: { kind: "sum", dice: [6] }, skills: [{ id: "wits" }], characters: [{ id: "you" }], hands: [{ name: "x" }] }).problems).toEqual([{ code: "shape", args: ["hands[0]"] }]);
    expect(validateConfig({ ...HANDS, hands: [{ id: "线索" }] })).toContainEqual({ code: "duplicate", args: ["线索"] });
    expect(validateConfig({ ...HANDS, hands: [{ id: "my hand" }] })).toContainEqual({ code: "ident", args: ["my hand"] });
    // The generated names are in the same namespace: a hand called like the played VAR is a duplicate, not a compile error later.
    expect(validateConfig({ ...HANDS, hands: [{ id: "出牌" }] })).toContainEqual({ code: "duplicate", args: ["出牌"] });
  });

  test("the generated ink declares each hand and the played VAR", () => {
    const ink = generateInk(HANDS);
    expect(ink).toContain("VAR 手牌 = ()\nVAR 出牌 = ()");
    // Without hands, the played VAR is there only for #use: a game with items has it, one without has not.
    expect(generateInk({ ...CONFIG, items: [] })).not.toContain("VAR 出牌");
  });

  test("the engine shows each hand's cards, and a #play choice carries one of them", () => {
    const engine = new GameEngine(HANDS, { rng: faces(1) });
    const session = new PlaySession(new Compiler(STORY()).Compile(), { setup: (s) => engine.setup(s, "昕") });
    const step = session.start();
    expect(engine.hud().hands).toEqual([{
      id: "手牌", name: "手牌",
      cards: [
        { id: "血手印", name: "血手印", desc: "门把手上。", deck: "线索", deckName: "线索" },
        { id: "半张票", name: "半张票", deck: "线索", deckName: "线索" },
        { id: "钥匙扣", name: "钥匙扣", deck: "线索", deckName: "线索" },
      ],
    }]);
    const play = engine.playOf(step.choices[0]);
    expect(play).toMatchObject({ hand: "手牌", name: "手牌", known: true });
    expect(play?.cards.map((c) => c.id)).toEqual(["血手印", "半张票", "钥匙扣"]);
    expect(engine.playOf(step.choices[1])).toBeNull();
    expect(engine.canChoose(step.choices[0])).toBe(true);
    expect(engine.playPayload("手牌", "半张票")).toEqual(played("半张票"));
    expect(engine.playPayload("手牌", "字条")).toBeNull();
    expect(engine.playPayload("桌面", "半张票")).toBeNull();
    engine.language = "en";
    expect(engine.cardName("血手印")).toBe("Bloody handprint");
    expect(engine.cardName("字条")).toBe("字条");
    expect(engine.hud().hands?.[0]).toMatchObject({ name: "Hand", cards: [{ name: "Bloody handprint", deckName: "Clues" }, {}, {}] });
  });

  test("a hand with no card in it, or one the config does not know, locks the choice", () => {
    const engine = new GameEngine(HANDS, { rng: faces(1) });
    const session = new PlaySession(new Compiler(STORY()).Compile(), { setup: (s) => engine.setup(s, "昕") });
    let step = session.start();
    for (const card of ["血手印", "半张票", "钥匙扣"]) step = session.choose(0, played(card));
    expect(step.ended).toBe(true);
    const unknown = new GameEngine(HANDS, { rng: faces(1) });
    const other = new PlaySession(new Compiler(STORY("#play:桌面")).Compile(), { setup: (s) => unknown.setup(s, "昕") });
    const first = other.start();
    expect(unknown.playOf(first.choices[0])).toMatchObject({ hand: "桌面", known: false, cards: [] });
    expect(unknown.canChoose(first.choices[0])).toBe(false);
  });

  test("the session writes the card before the choice runs, and keeps it through back, save and the language replay", () => {
    const engine = new GameEngine(HANDS, { rng: faces(1) });
    const session = new PlaySession(new Compiler(STORY()).Compile(), { setup: (s) => engine.setup(s, "昕") });
    session.start();
    let step = session.choose(0, played("半张票"));
    expect(step.paragraphs.map((p) => p.text)).toEqual(["票。"]);
    expect(engine.hud().hands?.[0].cards.map((c) => c.id)).toEqual(["血手印", "钥匙扣"]);
    expect(session.lastChoice).toEqual({ text: "打出一张", at: 1, payload: played("半张票") });
    const save = session.save();
    expect(save?.picks).toEqual([{ index: 0, payload: played("半张票") }]);
    session.back();
    expect(engine.hud().hands?.[0].cards).toHaveLength(3);
    step = session.choose(0, played("钥匙扣"));
    expect(step.paragraphs.map((p) => p.text)).toEqual(["扣。"]);
    // Loading the save brings the played card back, and the replay in another language plays it again.
    const again = new GameEngine(HANDS, { rng: faces(1) });
    const loaded = new PlaySession(new Compiler(STORY()).Compile(), { setup: (s) => again.setup(s, "昕") });
    loaded.start();
    loaded.load(save!);
    expect(again.hud().hands?.[0].cards.map((c) => c.id)).toEqual(["血手印", "钥匙扣"]);
    loaded.setLanguage("en");
    expect(loaded.log.map((p) => p.text)).toEqual(["桌上。", "票。"]);
    expect(again.hud().hands?.[0].cards.map((c) => c.id)).toEqual(["血手印", "钥匙扣"]);
    expect(loaded.save()?.picks).toEqual([{ index: 0, payload: played("半张票") }]);
  });

  test("a payload the story cannot take leaves the state as it was", () => {
    const engine = new GameEngine(HANDS, { rng: faces(1) });
    const session = new PlaySession(new Compiler(STORY()).Compile(), { setup: (s) => engine.setup(s, "昕") });
    session.start();
    const step = session.choose(0, { var: "出牌", item: "字条" });
    expect(step.errors).toHaveLength(1);
    expect(step.choices.map((c) => c.text)).toEqual(["打出一张", "走"]);
    expect(engine.hud().hands?.[0].cards).toHaveLength(3);
    expect(session.canGoBack).toBe(false);
    expect(session.choose(0, played("血手印")).paragraphs.map((p) => p.text)).toEqual(["血。"]);
  });

  test("the explorer plays a #play choice once per card in the hand, naming the card in the path", async () => {
    const r = await compileStory("main.ink", async () => STORY());
    const x = exploreStory(r.story!, { game: HANDS, character: "昕" });
    expect(x.errors).toEqual([]);
    const paths = x.endings.map((e) => e.choices.join(" > "));
    expect(paths).toContain("打出一张 ▸ 血手印 > 打出一张 ▸ 半张票 > 打出一张 ▸ 钥匙扣");
    expect(paths).toContain("打出一张 ▸ 钥匙扣 > 走");
    expect(x.checks?.unknownHands).toEqual([]);
    const bad = await compileStory("main.ink", async () => STORY("#play:桌面"));
    const y = exploreStory(bad.story!, { game: HANDS, character: "昕" });
    expect(y.checks?.unknownHands).toEqual([{ choice: "打出一张", hand: "桌面" }]);
    expect(y.endings.map((e) => e.choices.join(" > "))).toEqual(["走"]);
  });

  test("the random player plays a random card", async () => {
    const r = await compileStory("main.ink", async () => STORY());
    const s = simulateStory(r.story!, { game: HANDS, character: "昕", runs: 20, seed: 5 });
    expect(s.errors).toEqual([]);
    expect(s.stuck).toBe(0);
    expect(s.endings.reduce((n, e) => n + e.count, 0)).toBe(20);
  });
});

describe("playing several cards at once (#play:hand:min-max)", () => {
  const MANY = (tag: string) => `-> main
${generateInk(HANDS)}
=== main ===
~ 手牌 += 抽牌("线索")
~ 手牌 += 抽牌("线索")
~ 手牌 += 抽牌("线索")
桌上。
+ [投入 ${tag}]
    投入了 {LIST_COUNT(出牌)} 张。
    ~ 手牌 -= 出牌
    -> END
`;

  test("the tag reads a count or a range; without one it is one card", () => {
    expect(parsePlayTag("play:手牌")).toEqual({ hand: "手牌", min: 1, max: 1 });
    expect(parsePlayTag("play:手牌:2")).toEqual({ hand: "手牌", min: 2, max: 2 });
    expect(parsePlayTag("play:手牌:1-3")).toEqual({ hand: "手牌", min: 1, max: 3 });
    expect(parsePlayTag("play:手牌:3-1")).toBeNull();
    expect(parsePlayTag("play:手牌:0")).toBeNull();
    expect(parsePlayTag("play:手牌:x")).toBeNull();
  });

  test("the cards picked go into played together; too few is no payload; a hand short of the minimum locks the choice", () => {
    const engine = new GameEngine(HANDS, { rng: faces(1) });
    const s = new PlaySession(new Compiler(MANY("#play:手牌:2-3")).Compile(), { setup: (st) => engine.setup(st, "昕") });
    const step = s.start();
    const play = engine.playOf(step.choices[0])!;
    expect(play).toMatchObject({ hand: "手牌", min: 2, max: 3 });
    expect(engine.playPayload("手牌", ["血手印"], play)).toBeNull();
    expect(engine.playPayload("手牌", ["血手印", "血手印"], play)).toBeNull();
    expect(engine.playPayload("手牌", ["血手印", "钥匙扣", "半张票", "半张票"], play)).toBeNull();
    expect(engine.playPayload("手牌", ["血手印", "钥匙扣"], play)).toEqual({ var: "出牌", items: ["血手印", "钥匙扣"] });
    expect(s.choose(0, engine.playPayload("手牌", ["血手印", "钥匙扣"], play)!).paragraphs.map((p) => p.text)).toEqual(["投入了 2 张。"]);
    expect(engine.hud().hands?.[0].cards.map((c) => c.id)).toEqual(["半张票"]);
    const short = new GameEngine(HANDS, { rng: faces(1) });
    const t = new PlaySession(new Compiler(MANY("#play:手牌:4")).Compile(), { setup: (st) => short.setup(st, "昕") });
    expect(short.canChoose(t.start().choices[0])).toBe(false);
  });

  test("the explorer plays each card alone (when one may go) and all of them (when all may), and says it sampled", async () => {
    const r = await compileStory("main.ink", async () => MANY("#play:手牌:1-3"));
    const x = exploreStory(r.story!, { game: HANDS, character: "昕" });
    expect(x.errors).toEqual([]);
    expect(x.endings.map((e) => e.choices.join(" > ")).sort()).toEqual([
      "投入 ▸ 半张票", "投入 ▸ 血手印", "投入 ▸ 血手印 + 半张票 + 钥匙扣", "投入 ▸ 钥匙扣",
    ]);
    const s = simulateStory(r.story!, { game: HANDS, character: "昕", runs: 10, seed: 3 });
    expect(s.errors).toEqual([]);
    expect(s.stuck).toBe(0);
  });
});
