import { expect, test } from "vitest";
import { splitLinks, withoutLinks } from "../src/play/links";

test("note links in a paragraph: [[note]] and [[note|shown]]; the rest is text", () => {
  expect(splitLinks("你见到了[[酒馆老板]],他提起[[人物/守灯人|那个守灯人]]。")).toEqual([
    { text: "你见到了" },
    { link: "酒馆老板", text: "酒馆老板" },
    { text: ",他提起" },
    { link: "人物/守灯人", text: "那个守灯人" },
    { text: "。" },
  ]);
  expect(splitLinks("没有链接")).toEqual([{ text: "没有链接" }]);
  // Not a link: an unclosed bracket, an empty one.
  expect(splitLinks("[[没关上")).toEqual([{ text: "[[没关上" }]);
  expect(splitLinks("[[]]")).toEqual([{ text: "[[]]" }]);
});

test("for the exported page (no vault to link into): the shown text only", () => {
  expect(withoutLinks("见到了[[酒馆老板]]和[[人物/守灯人|她]]。")).toBe("见到了酒馆老板和她。");
});
