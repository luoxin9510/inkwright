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
        开了。
    - else:
        断了。
    }
    -> END
* [走]
    走了。
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
  (document.querySelector("#choices button") as HTMLElement).click();
  expect(texts("#dice li")).toHaveLength(1);
  expect(document.querySelector("#dice summary")?.textContent).toBe("掷骰记录 (1)");
  expect(["开了。", "断了。"]).toContain(texts("#story p").at(-1));

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
