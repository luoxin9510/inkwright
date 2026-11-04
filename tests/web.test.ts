// @vitest-environment happy-dom
import { describe, expect, test, beforeEach } from "vitest";
import { Compiler } from "inkjs/full";
import INK_RUNTIME from "virtual:ink-runtime";
import GAME_ENGINE from "virtual:game-engine";
import { generateInk } from "../src/game/inkgen";
import { CONFIG } from "./fixtures/gameConfig";
import { buildWebPage, exportFileName, storyTitle } from "../src/export/web";
import { setLanguage } from "../src/i18n";

const SOURCE = `# title: 雨夜 </script> & <b>
Hello.
* [Left] You went left.
* [Right] You went right.
- -> END
`;

function compileJson(src: string): string {
  return new Compiler(src).Compile().ToJson() as string;
}

/** Loads the page into the test document and runs its scripts. */
function mount(html: string): void {
  const doc = new DOMParser().parseFromString(html, "text/html");
  document.documentElement.innerHTML = doc.documentElement.innerHTML;
  for (const s of Array.from(document.querySelectorAll("script"))) {
    if (s.type === "application/json") continue;
    new Function(s.textContent ?? "")();
  }
}

const texts = (sel: string) => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent);

beforeEach(() => {
  localStorage.clear();
  setLanguage("en");
});

test("title comes from the # title global tag, else the fallback", () => {
  expect(storyTitle(["title: My Game", "author: me"], "x")).toBe("My Game");
  expect(storyTitle(["author: me"], "fallback")).toBe("fallback");
  expect(storyTitle(null, "fallback")).toBe("fallback");
});

test("export file is named after the folder for main.ink, else after the file", () => {
  expect(exportFileName("游戏/雨夜来客/main.ink")).toBe("游戏/雨夜来客/雨夜来客.html");
  expect(exportFileName("游戏/雨夜来客/story.ink")).toBe("游戏/雨夜来客/story.html");
  expect(exportFileName("main.ink")).toBe("main.html");
});

test("the page escapes the title and keeps scripts closed", () => {
  const html = buildWebPage({ title: "a </script> & <b>", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "t" });
  expect(html).toContain("<title>a &lt;/script&gt; &amp; &lt;b&gt;</title>");
  expect(html.match(/<\/script>/g)?.length).toBe(html.match(/<script/g)?.length);
});

test("the page plays, goes back, restarts and resumes from localStorage", () => {
  const html = buildWebPage({ title: "T", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "t" });
  mount(html);
  expect(texts("#story p")).toEqual(["Hello."]);
  expect(texts("#choices button")).toEqual(["Left", "Right"]);

  (document.querySelector("#choices button:nth-child(2)") as HTMLElement).click();
  expect(texts("#story p")).toEqual(["Hello.", "Right", "You went right."]);
  expect(texts("#choices button")).toEqual([]);
  expect(document.querySelector("#end")?.textContent).toBe(T_END);

  // Reloading the page resumes where the player was.
  mount(html);
  expect(texts("#story p")).toEqual(["Hello.", "Right", "You went right."]);

  (document.querySelector("#back") as HTMLElement).click();
  expect(texts("#story p")).toEqual(["Hello."]);
  expect(texts("#choices button")).toEqual(["Left", "Right"]);

  (document.querySelector("#choices button") as HTMLElement).click();
  (document.querySelector("#restart") as HTMLElement).click();
  expect(texts("#story p")).toEqual(["Hello."]);
  expect((document.querySelector("#back") as HTMLButtonElement).disabled).toBe(true);
});

test("after a choice the first new paragraph is scrolled to the top; after going back or resuming, the choices", () => {
  const scrolled: { text: string | null; block: unknown }[] = [];
  const proto = Element.prototype as unknown as { scrollIntoView: (o: unknown) => void };
  const original = proto.scrollIntoView;
  proto.scrollIntoView = function (this: Element, o: unknown) { scrolled.push({ text: this.textContent, block: (o as { block: unknown }).block }); };
  try {
    mount(buildWebPage({ title: "T", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "t" }));
    (document.querySelector("#choices button:nth-child(2)") as HTMLElement).click();
    expect(scrolled.at(-1)).toEqual({ text: "Right", block: "start" });
    (document.querySelector("#back") as HTMLElement).click();
    expect(scrolled.at(-1)).toEqual({ text: "LeftRight", block: "end" });
    // Resuming a run from localStorage shows the choices, not the first paragraph.
    (document.querySelector("#choices button:nth-child(2)") as HTMLElement).click();
    scrolled.length = 0;
    mount(buildWebPage({ title: "T", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "t" }));
    expect(texts("#story p")).toEqual(["Hello.", "Right", "You went right."]);
    expect(scrolled.at(-1)).toEqual({ text: "", block: "end" });
  } finally {
    proto.scrollIntoView = original;
  }
});

test("a save from a different story version is replayed as far as it fits, then says where it stopped", () => {
  mount(buildWebPage({ title: "T", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "t" }));
  (document.querySelector("#choices button") as HTMLElement).click();
  mount(buildWebPage({ title: "T", storyJson: compileJson("Other.\n-> END\n"), runtime: INK_RUNTIME, id: "t" }));
  expect(texts("#story p")).toEqual(["Other.", "The story was updated; your progress stops at step 1."]);
});

const T_END = "— The End —";

const BILINGUAL = [
  'VAR 语言 = "zh"',
  '{双("开始。", "Start.")}',
  '* [{双("左", "Left")}] {双("向左。", "Went left.")}',
  '* [{双("右", "Right")}] {双("向右。", "Went right.")}',
  "- -> END",
  "=== function 双(zh, en) ===",
  '{ 语言 == "en":',
  "  ~ return en",
  "}",
  "~ return zh",
].join("\n");

test("a bilingual page switches language, replaying the run, and remembers it", () => {
  setLanguage("zh");
  const html = buildWebPage({ title: "T", storyJson: compileJson(BILINGUAL), runtime: INK_RUNTIME, id: "b", languageVar: "语言" });
  mount(html);
  const lang = document.querySelector("#language") as HTMLSelectElement;
  expect(lang.hidden).toBe(false);
  expect(lang.value).toBe("zh");
  (document.querySelector("#choices button") as HTMLElement).click();
  expect(texts("#story p")).toEqual(["开始。", "左", "向左。"]);

  lang.value = "en";
  lang.dispatchEvent(new Event("change"));
  expect(texts("#story p")).toEqual(["Start.", "Left", "Went left."]);
  expect(document.querySelector("#restart")?.textContent).toBe("Restart");
  expect(document.documentElement.lang).toBe("en");

  // Reload: progress and language are kept; restart stays in English.
  mount(html);
  expect(texts("#story p")).toEqual(["Start.", "Left", "Went left."]);
  (document.querySelector("#restart") as HTMLElement).click();
  expect(texts("#story p")).toEqual(["Start."]);
  expect(texts("#choices button")).toEqual(["Left", "Right"]);
});

test("a looping story stops with an error instead of freezing the page", () => {
  mount(buildWebPage({ title: "T", storyJson: compileJson("Start.\n- (top)\n~ temp x = 1\n-> top\n"), runtime: INK_RUNTIME, id: "loop" }));
  expect(document.querySelector("#story p.error")?.textContent).toContain("loop");
});

test("a choice that loops is not saved: reloading resumes before it", () => {
  const src = "Start.\n* [Loop] -> spin\n* [Fine] Ok.\n-> END\n=== spin ===\n- (top)\n~ temp x = 1\n-> top\n";
  const html = buildWebPage({ title: "T", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "spin" });
  mount(html);
  (document.querySelector("#choices button") as HTMLElement).click();
  expect(document.querySelector("#story p.error")).not.toBeNull();
  expect((document.querySelector("#end") as HTMLElement).hidden).toBe(true);
  // Undo still gets back to the choice.
  expect((document.querySelector("#back") as HTMLButtonElement).disabled).toBe(false);

  mount(html);
  expect(texts("#story p")).toEqual(["Start."]);
  expect(texts("#choices button")).toEqual(["Loop", "Fine"]);
});

test("a choice that throws shows the error and leaves undo history unchanged", () => {
  mount(buildWebPage({ title: "T", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "throw" }));
  const proto = (globalThis as unknown as { inkjs: { Story: { prototype: { ChooseChoiceIndex: () => void } } } }).inkjs.Story.prototype;
  const original = proto.ChooseChoiceIndex;
  proto.ChooseChoiceIndex = () => { throw new Error("boom"); };
  try {
    (document.querySelector("#choices button") as HTMLElement).click();
  } finally {
    proto.ChooseChoiceIndex = original;
  }
  expect(document.querySelector("#story p.error")?.textContent).toContain("boom");
  expect((document.querySelector("#back") as HTMLButtonElement).disabled).toBe(true);
  expect(texts("#choices button")).toEqual(["Left", "Right"]);
});

test("a page for a story without a language variable has no language switch", () => {
  mount(buildWebPage({ title: "T", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "t" }));
  expect((document.querySelector("#language") as HTMLSelectElement).hidden).toBe(true);
});

const GAME = `-> main
${generateInk(CONFIG)}
=== main ===
门。
{洞察力 >= 3: 黑。 #voice:洞察力}
* [撬 #check:力量:10]
    { 检定("力量", 10) >= 3:
        开了。 #fx:flash
    - else:
        断了。 #fx:flash
    }
    -> END
* [走]
    走了。
    -> END
* [捅 #needs:刀]
    -> END
`;

test("a game page shows the HUD, voices, check odds and the dice log, and switches character and language", () => {
  setLanguage("zh");
  const html = buildWebPage({ title: "G", storyJson: compileJson(GAME), runtime: INK_RUNTIME, id: "g", languageVar: "语言", game: CONFIG, engine: GAME_ENGINE });
  mount(html);
  const hud = () => document.querySelector("#hud")?.textContent ?? "";
  expect(hud()).toContain("理智 3"); // 昕, the first character
  expect(hud()).toContain("恐惧 0/100");
  expect(document.querySelector("#story p.voice .who")?.textContent).toBe("洞察力");
  expect(texts("#choices button .check")).toEqual(["力量 10 · 42%"]); // 力量 2 needs 8+ on 2d6
  // The inventory is in the HUD; a choice that needs an item not carried is shown locked.
  expect(hud()).toContain("背包手机");
  const locked = Array.from(document.querySelectorAll<HTMLButtonElement>("#choices button")).find((b) => b.textContent?.startsWith("捅"));
  expect(locked?.disabled).toBe(true);
  expect(locked?.querySelector(".need")?.textContent).toBe("需要 刀");
  (document.querySelector("#choices button") as HTMLElement).click();
  expect(texts("#dice li")).toHaveLength(1);
  expect(document.querySelector("#dice summary")?.textContent).toBe("掷骰记录 (1)");
  expect(["开了。", "断了。"]).toContain(texts("#story p").at(-1));
  // The roll shows as a card under the choice that made it, and the line's #fx:flash plays on the story.
  const card = document.querySelector("#story .roll");
  expect(card?.previousElementSibling?.className).toBe("chosen");
  expect(card?.querySelectorAll(".die")).toHaveLength(2);
  expect(card?.querySelector(".band")?.textContent).toMatch(/成功|失败/);
  expect(document.querySelector("#story")?.classList.contains("fx-flash")).toBe(true);

  // Another character starts a new run with their preset.
  const who = document.querySelector("#character") as HTMLSelectElement;
  expect(who.hidden).toBe(false);
  who.value = "阿波";
  who.dispatchEvent(new Event("change"));
  expect(hud()).toContain("力量 5");
  expect(texts("#choices button .check")).toEqual(["力量 10 · 83%"]);
  expect(texts("#dice li")).toHaveLength(0);

  // Names follow the story's language.
  const lang = document.querySelector("#language") as HTMLSelectElement;
  lang.value = "en";
  lang.dispatchEvent(new Event("change"));
  expect(hud()).toContain("Reason 4");
  expect(document.querySelector("#story p.voice .who")?.textContent).toBe("洞察力"); // no English name given

  // Reload: the run and the character are kept.
  mount(html);
  expect(hud()).toContain("Reason 4");
  expect((document.querySelector("#character") as HTMLSelectElement).value).toBe("阿波");
});

test("a page without a game config has no HUD, character picker or dice log", () => {
  const html = buildWebPage({ title: "T", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "t" });
  mount(html);
  expect((document.querySelector("#hud") as HTMLElement).hidden).toBe(true);
  expect((document.querySelector("#character") as HTMLElement).hidden).toBe(true);
  expect((document.querySelector("#dice") as HTMLElement).hidden).toBe(true);
  expect(html.match(/<script>/g)).toHaveLength(2); // runtime + player, no engine
});

test("a game page with one playable character has no picker", () => {
  const config = { ...CONFIG, characters: [CONFIG.characters[0], { ...CONFIG.characters[1], playable: false }] };
  const html = buildWebPage({ title: "G", storyJson: compileJson(GAME), runtime: INK_RUNTIME, id: "g1", languageVar: "语言", game: config, engine: GAME_ENGINE });
  mount(html);
  expect((document.querySelector("#character") as HTMLElement).hidden).toBe(true);
  expect(document.querySelector("#hud")?.textContent).toContain("理智 3");
});

test("a game page shows each hand as cards; a #play choice waits for a tapped card and plays it", () => {
  setLanguage("zh");
  const config = {
    ...CONFIG,
    decks: [{ id: "线索", name: { zh: "线索", en: "Clues" }, cards: [{ id: "血手印", name: { zh: "血手印", en: "Bloody handprint" }, desc: { zh: "门把手上。", en: "On the handle." } }, { id: "半张票", name: { zh: "半张票", en: "Half a ticket" } }] }],
    hands: [{ id: "手牌", name: { zh: "手牌", en: "Hand" } }],
  };
  const src = `-> main\n${generateInk(config)}\n=== main ===\n~ 手牌 += 抽牌("线索")\n~ 手牌 += 抽牌("线索")\n桌上。\n-> turn\n=== turn ===\n{ LIST_COUNT(手牌) == 0: -> END }\n+ [打出一张 #play:手牌]\n    ~ 手牌 -= 出牌\n    { 出牌 == 血手印: 血。 }\n    { 出牌 == 半张票: 票。 }\n    -> turn\n+ [走]\n    走了。\n    -> END\n`;
  const html = buildWebPage({ title: "H", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "h", languageVar: "语言", game: config, engine: GAME_ENGINE });
  mount(html);
  const cards = () => Array.from(document.querySelectorAll<HTMLButtonElement>("#hands .card"));
  const play = () => document.querySelector<HTMLButtonElement>("#choices button")!;
  expect(document.querySelector<HTMLElement>("#hands")?.hidden).toBe(false);
  expect(cards().map((c) => c.textContent)).toEqual(["线索血手印", "线索半张票"]);
  expect(play().disabled).toBe(true);
  expect(play().querySelector(".need")?.textContent).toBe("先选一张牌");
  // Tap a card: it is raised, its description shows, the choice carries it.
  cards()[0].click();
  expect(cards()[0].className).toBe("card on");
  expect(document.querySelector("#hands .desc")?.textContent).toBe("血手印: 门把手上。");
  expect(play().disabled).toBe(false);
  expect(play().textContent).toBe("打出一张 · 血手印");
  // Tap it again: put back.
  cards()[0].click();
  expect(cards()[0].className).toBe("card");
  expect(play().disabled).toBe(true);
  cards()[1].click();
  play().click();
  expect(texts("#story p").slice(-2)).toEqual(["打出一张 · 半张票", "票。"]);
  expect(cards().map((c) => c.textContent)).toEqual(["线索血手印"]);
  expect(document.querySelector("#hands .desc")).toBeNull();
  // Back brings the card back; the language replay plays it again.
  (document.querySelector("#back") as HTMLElement).click();
  expect(cards()).toHaveLength(2);
  cards()[1].click();
  play().click();
  const lang = document.querySelector("#language") as HTMLSelectElement;
  lang.value = "en";
  lang.dispatchEvent(new Event("change"));
  expect(cards().map((c) => c.textContent)).toEqual(["CluesBloody handprint"]);
  expect(texts("#story p").slice(-2)).toEqual(["打出一张 · Half a ticket", "票。"]);
  // Reload: the run is kept, with the hand as it was.
  mount(html);
  expect(cards().map((c) => c.textContent)).toEqual(["CluesBloody handprint"]);
  expect(document.querySelector("#hands .hand .name")?.textContent).toBe("Hand");
});

test("a chaos bag game draws a token instead of dice: a chip on the roll card and the token's name in the log", () => {
  setLanguage("zh");
  const config = { ...CONFIG, rules: { kind: "bag" as const, tokens: [{ id: "skull", name: { zh: "骷髅", en: "Skull" }, value: -2 }] } };
  const src = `-> main\n${generateInk(config)}\n=== main ===\n门。\n* [撬 #check:力量:3]\n    { 检定("力量", 3) >= 3: 开了。|断了。 }\n    -> END\n`;
  mount(buildWebPage({ title: "B", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "b", languageVar: "语言", game: config, engine: GAME_ENGINE }));
  expect(texts("#choices button .check")).toEqual(["力量 3 · 0%"]); // 力量 2 and only the skull to draw
  (document.querySelector("#choices button") as HTMLElement).click();
  expect(texts("#story p").at(-1)).toBe("断了。");
  const card = document.querySelector("#story .roll");
  expect(Array.from(card?.querySelectorAll(".die") ?? []).map((d) => [d.className, d.textContent])).toEqual([["die token", "骷髅"]]);
  expect(card?.querySelector(".band")?.textContent).toBe("失败");
  expect(texts("#dice li")).toEqual(["力量 3: 骷髅 +2 = 0 · 失败 (0%)"]);
});

test("a game page draws the growing dungeon: floor squares, walls, doors, the lit room and a room's note", () => {
  setLanguage("zh");
  const config = {
    ...CONFIG,
    dungeon: { width: 9, height: 10, shapes: [
      { id: "gate", cells: ["###", "###"], doors: ["top:1", "top:3"], entry: "bottom:2" },
      { id: "corridor", cells: ["#", "#", "#"], doors: ["top:1", "bottom:1"] },
    ] },
  };
  const src = `-> main\n${generateInk(config)}\n=== main ===\n~ 开地城("gate")\n门厅。\n+ [往里走]\n    ~ temp r = 接房间("corridor", 1, 1)\n    ~ 所在房间 = r\n    ~ 标记房间(r, "⚔")\n    走廊。\n    -> END\n`;
  mount(buildWebPage({ title: "D", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "d", languageVar: "语言", game: config, engine: GAME_ENGINE }));
  const dungeon = document.querySelector<HTMLElement>("#dungeon");
  expect(dungeon?.hidden).toBe(false);
  expect(dungeon?.querySelectorAll("rect.floor")).toHaveLength(6);
  expect(dungeon?.querySelectorAll("rect.here")).toHaveLength(6);
  expect(dungeon?.querySelectorAll("line.door.free")).toHaveLength(2);
  expect(dungeon?.querySelectorAll("line.door.used")).toHaveLength(1);
  (document.querySelector("#choices button") as HTMLElement).click();
  expect(dungeon?.querySelectorAll("rect.floor")).toHaveLength(9);
  expect(dungeon?.querySelectorAll("rect.corridor")).toHaveLength(3);
  expect(dungeon?.querySelectorAll("rect.here")).toHaveLength(3);
  expect(dungeon?.querySelector("text")?.textContent).toBe("⚔");
  expect(dungeon?.querySelectorAll("line.wall").length).toBeGreaterThan(10);
});

test("a game page lists the party: a line per member with title, stats and gear, the fallen one faded", () => {
  setLanguage("zh");
  const config = {
    ...CONFIG,
    characters: CONFIG.characters.map((c) => ({ ...c, items: [] })),
    party: { name: "小队", down: "生命", stats: [{ id: "生命", max: "上限" }, { id: "上限", hidden: true }], members: [{ id: "甲", name: "战士", stats: { 生命: 5, 上限: 5 }, items: ["刀"] }, { id: "乙", name: "法师", stats: { 生命: 2, 上限: 2 } }] },
  };
  const src = `-> main\n${generateInk(config)}\n=== main ===\n进门。\n+ [挨打]\n    ~ 生命_乙 = 0\n    ~ 称号_甲 = "老兵"\n    倒了。\n    -> END\n`;
  mount(buildWebPage({ title: "P", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "p", languageVar: "语言", game: config, engine: GAME_ENGINE }));
  const lines = () => Array.from(document.querySelectorAll("#hud > div")).map((d) => d.textContent).filter((t) => /战士|法师/.test(t ?? ""));
  expect(lines()).toEqual(["战士生命 5/5 · 刀", "法师生命 2/2"]);
  // The gear is on the members; the protagonist's empty pack is left out.
  expect(texts("#hud > div").some((t) => t.startsWith("背包"))).toBe(false);
  (document.querySelector("#choices button") as HTMLElement).click();
  expect(lines()).toEqual(["战士老兵 · 生命 5/5 · 刀", "法师生命 0/2"]);
  expect(Array.from(document.querySelectorAll("#hud > div.down")).map((d) => d.textContent)).toEqual(["法师生命 0/2"]);
});

test("a game page draws the map: places, a question mark until revealed, counters, tokens, and a place that a choice goes to is a button", () => {
  setLanguage("zh");
  const config = {
    ...CONFIG,
    map: {
      width: 400, height: 300,
      places: [
        { id: "门厅", name: { zh: "门厅", en: "Hall" }, x: 100, y: 150, links: ["书房", "地窖"] },
        { id: "书房", name: { zh: "书房", en: "Study" }, x: 300, y: 80, links: ["门厅"], counter: "线索_书房", counterName: { zh: "线索", en: "Clues" } },
        { id: "地窖", name: { zh: "地窖", en: "Cellar" }, x: 300, y: 250, hidden: true, links: ["门厅"] },
      ],
      tokens: [{ id: "食尸鬼", name: { zh: "食尸鬼", en: "Ghoul" }, color: "#c33", at: "地窖" }],
    },
  };
  const src = `-> main\n${generateInk(config)}\nVAR 线索_书房 = 2\n=== main ===\n在 {所在}。\n+ [去书房 #go:书房]\n    ~ 所在 = 书房\n    ~ 线索_书房 -= 1\n    -> main\n+ [下地窖 #go:地窖]\n    ~ 已揭示 += 地窖\n    ~ 所在 = 地窖\n    ~ 食尸鬼_在 = ()\n    -> main\n+ [走]\n    -> END\n`;
  const html = buildWebPage({ title: "M", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "m", languageVar: "语言", game: config, engine: GAME_ENGINE, mapImage: "data:image/svg+xml;base64,PHN2Zy8+" });
  mount(html);
  const places = () => Array.from(document.querySelectorAll<HTMLElement>("#map .place"));
  expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(false);
  expect(document.querySelector("#map img")?.getAttribute("src")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  expect(document.querySelectorAll("#map line")).toHaveLength(2);
  expect(places().map((p) => [p.tagName, p.className, p.textContent])).toEqual([
    ["DIV", "place here", "门厅"],
    ["BUTTON", "place go", "书房2"],
    ["BUTTON", "place unknown go", "?"],
  ]);
  expect(places()[0].style.left).toBe("25%");
  expect(document.querySelector<HTMLElement>("#map .token")?.title).toBe("食尸鬼");
  // Tapping the study takes the choice that goes there.
  places()[1].click();
  expect(texts("#story p").slice(-2)).toEqual(["去书房", "在 书房。"]);
  expect(places().map((p) => p.className)).toEqual(["place", "place here go", "place unknown go"]);
  expect(places()[1].querySelector(".counter")?.textContent).toBe("1");
  places()[2].click();
  expect(places()[2].className).toBe("place here go");
  expect(places()[2].textContent).toBe("地窖");
  expect(document.querySelector("#map .token")).toBeNull();
  (document.querySelector("#back") as HTMLElement).click();
  expect(places()[2].textContent).toBe("?");
  expect(document.querySelector("#map .token")).not.toBeNull();
});

test("an #input choice gets a text field; the button waits for a line, which goes into the VAR and is kept through back, reload and the language replay", () => {
  setLanguage("zh");
  const src = [
    'VAR 语言 = "zh"',
    'VAR cat = "猫"',
    '你捡到一只猫。',
    '+ [{语言 == "en": Name it|给它起名} #input:cat]',
    '    { 语言 == "en": You call it {cat}.|你叫它{cat}。 }',
    '    -> END',
    '+ [{语言 == "en": Leave it|不起名}]',
    '    它走了。',
    '    -> END',
  ].join("\n");
  const html = buildWebPage({ title: "I", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "i", languageVar: "语言" });
  mount(html);
  const field = () => document.querySelector<HTMLInputElement>("#choices input");
  const name = () => document.querySelector<HTMLButtonElement>("#choices button")!;
  expect(field()?.placeholder).toBe("写在这里…");
  expect(name().disabled).toBe(true);
  field()!.value = "   ";
  field()!.dispatchEvent(new Event("input"));
  expect(name().disabled).toBe(true);
  field()!.value = " 煤球 ";
  field()!.dispatchEvent(new Event("input"));
  expect(name().disabled).toBe(false);
  name().click();
  expect(texts("#story p").slice(-2)).toEqual(["给它起名 · 煤球", "你叫它煤球。"]);
  expect(field()).toBeNull();
  // Back: the field is empty again; type another name.
  (document.querySelector("#back") as HTMLElement).click();
  expect(field()?.value).toBe("");
  field()!.value = "雪团";
  field()!.dispatchEvent(new Event("input"));
  field()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  expect(texts("#story p").at(-1)).toBe("你叫它雪团。");
  const lang = document.querySelector("#language") as HTMLSelectElement;
  lang.value = "en";
  lang.dispatchEvent(new Event("change"));
  expect(texts("#story p").slice(-2)).toEqual(["Name it · 雪团", "You call it 雪团."]);
  mount(html);
  expect(texts("#story p").at(-1)).toBe("You call it 雪团.");
});

test("a game page fades the faces that do not count: the lowest of 4d6kh3, the misses of a pool", () => {
  setLanguage("zh");
  const src = `-> main\n${generateInk(CONFIG)}\n=== main ===\n开始。\n* [掷]\n    属性 {掷("4d6kh3")}。\n    命中 {掷("6d6>=4")}。\n    -> END\n`;
  mount(buildWebPage({ title: "K", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "k", languageVar: "语言", game: CONFIG, engine: GAME_ENGINE }));
  (document.querySelector("#choices button") as HTMLElement).click();
  const [stat, pool] = Array.from(document.querySelectorAll("#story .roll.free"));
  const faces = (card: Element) => Array.from(card.querySelectorAll(".die")).map((d) => ({ face: Number(d.textContent), out: d.classList.contains("dropped") }));
  const kept = faces(stat);
  expect(kept).toHaveLength(4);
  expect(kept.filter((f) => f.out)).toHaveLength(1);
  expect(kept.find((f) => f.out)!.face).toBe(Math.min(...kept.map((f) => f.face)));
  const hits = faces(pool);
  expect(hits).toHaveLength(6);
  for (const f of hits) expect(f.out).toBe(f.face < 4);
});

describe("re-exported pages keep the player's progress", () => {
  const V1 = "开始。\n{RANDOM(1, 1000)}\n+ [向左] -> k\n+ [向右] -> k\n=== k ===\n第二屏 {~甲|乙|丙}。\n+ [推门] -> m\n+ [敲门] -> m\n=== m ===\n第三屏。\n+ [结束] -> END\n";
  const page = (src: string, extra: Record<string, unknown> = {}) => buildWebPage({ title: "R", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "r", ...extra });
  const click = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("#choices button")).find((b) => b.textContent?.startsWith(text))!.click();

  test("a new version of the story replays the run: a choice moved down is found, ink's RANDOM and shuffles come out the same", () => {
    mount(page(V1));
    click("向右");
    click("敲门");
    const before = texts("#story p");
    // The author adds a choice at the top of the first screen and re-exports.
    mount(page(V1.replace("+ [向左] -> k", "+ [新的选项] -> k\n+ [向左] -> k")));
    expect(texts("#story p")).toEqual(before);
    expect(texts("#choices button")).toEqual(["结束"]);
    expect(document.querySelector("#story p.note")).toBeNull();
  });

  test("a taken choice that is gone stops the run there, with a note", () => {
    mount(page(V1));
    click("向右");
    click("敲门");
    mount(page(V1.replace("+ [敲门] -> m\n", "")));
    expect(texts("#choices button")).toEqual(["推门"]);
    expect(texts("#story p.note")).toEqual(["The story was updated; your progress stops at step 2."]);
    // Playing on from there is saved: reloading keeps it.
    click("推门");
    mount(page(V1.replace("+ [敲门] -> m\n", "")));
    expect(texts("#choices button")).toEqual(["结束"]);
  });

  test("progress saved by an older page (choices by index only) is replayed by index", () => {
    mount(page(V1));
    click("向右");
    const saved = JSON.parse(localStorage.getItem("inkwright:r")!);
    saved.picks = saved.picks.map((p: { index: number }) => p.index);
    saved.version = "old";
    localStorage.setItem("inkwright:r", JSON.stringify(saved));
    mount(page(V1));
    expect(texts("#choices button")).toEqual(["推门", "敲门"]);
  });

  test("a game page re-exported: the run's dice come out the same", () => {
    setLanguage("zh");
    const src = `-> main\n${generateInk(CONFIG)}\n=== main ===\n门。\n* [撬 #check:力量:10]\n    { 检定("力量", 10) >= 3: 开了。|断了。 }\n    -> next\n=== next ===\n再来一次 {掷("3d6")}。\n* [走] -> END\n`;
    const game = { languageVar: "语言", game: CONFIG, engine: GAME_ENGINE };
    mount(page(src, game));
    click("撬");
    const dice = texts("#story .roll");
    const story = texts("#story p");
    mount(page(src.replace("门。", "一扇门。"), game));
    expect(texts("#story .roll")).toEqual(dice);
    expect(texts("#story p").slice(1)).toEqual(story.slice(1));
  });
});

test("a saved run that cannot be replayed (broken) starts the page over, keeps the old save aside and saves new progress", () => {
  const src = "开始。\n+ [向左] -> k\n+ [向右] -> k\n=== k ===\n到了。\n-> END\n";
  const broken = JSON.stringify({ version: "old", state: "{}", log: [], history: [], start: "{ not json", picks: [1] });
  localStorage.setItem("inkwright:b", broken);
  mount(buildWebPage({ title: "B", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "b" }));
  expect(texts("#choices button")).toEqual(["向左", "向右"]);
  expect(localStorage.getItem("inkwright:b:old")).toBe(broken);
  (document.querySelector("#choices button") as HTMLElement).click();
  expect(texts("#story p")).toEqual(["开始。", "向左", "到了。"]);
  // The new progress is saved (the page is not stuck "replaying").
  mount(buildWebPage({ title: "B", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "b" }));
  expect(texts("#story p")).toEqual(["开始。", "向左", "到了。"]);
});

test("a game page shows a clock as slices and a track as boxes of four ticks", () => {
  const config = { ...CONFIG, resources: [...CONFIG.resources, { id: "末日", min: 0, max: 4, initial: 0, display: "clock" as const }, { id: "誓言", min: 0, max: 12, initial: 0, display: "track" as const }] };
  const src = `-> main\n${generateInk(config)}\n=== main ===\n~ 末日 = 3\n~ 誓言 = 6\n门。\n* [走] -> END\n`;
  mount(buildWebPage({ title: "C", storyJson: compileJson(src), runtime: INK_RUNTIME, id: "c", languageVar: "语言", game: config, engine: GAME_ENGINE }));
  expect(document.querySelector("#hud")?.textContent).toContain("末日 ●●●○");
  expect(document.querySelector("#hud")?.textContent).toContain("誓言 ■◑□");
});
