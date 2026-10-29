// @vitest-environment happy-dom
import { expect, test, beforeEach } from "vitest";
import { Compiler } from "inkjs/full";
import INK_RUNTIME from "virtual:ink-runtime";
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

test("a save from a different story version is ignored", () => {
  mount(buildWebPage({ title: "T", storyJson: compileJson(SOURCE), runtime: INK_RUNTIME, id: "t" }));
  (document.querySelector("#choices button") as HTMLElement).click();
  mount(buildWebPage({ title: "T", storyJson: compileJson("Other.\n-> END\n"), runtime: INK_RUNTIME, id: "t" }));
  expect(texts("#story p")).toEqual(["Other."]);
});

const T_END = "— The End —";
