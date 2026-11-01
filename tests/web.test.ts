// @vitest-environment happy-dom
import { expect, test, beforeEach } from "vitest";
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

test("a save from a different story version is ignored", () => {
  mount(buildWebPage({ title: "T", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "t" }));
  (document.querySelector("#choices button") as HTMLElement).click();
  mount(buildWebPage({ title: "T", storyJson: compileJson("Other.\n-> END\n"), runtime: INK_RUNTIME, id: "t" }));
  expect(texts("#story p")).toEqual(["Other."]);
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
