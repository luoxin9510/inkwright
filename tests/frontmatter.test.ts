import { expect, test } from "vitest";
import { parse } from "yaml";
import { splitNote } from "../src/game/frontmatter";
import { folderOf, storyName } from "../src/paths";

test("a note splits into its frontmatter and body; no frontmatter, bad YAML and a non-object are told apart", () => {
  expect(splitNote("---\nname: 钥匙\ncost: 2\n---\n正文\n", parse)).toEqual({ raw: { name: "钥匙", cost: 2 }, frontmatter: { name: "钥匙", cost: 2 }, body: "正文\n" });
  expect(splitNote("---\r\nname: a\r\n---", parse).frontmatter).toEqual({ name: "a" });
  expect(splitNote("只有正文", parse)).toEqual({ raw: undefined, frontmatter: undefined, body: "只有正文" });
  const bad = splitNote("---\nname: [\n---\nbody", parse);
  expect([bad.frontmatter, bad.body, typeof bad.error]).toEqual([undefined, "body", "string"]);
  expect(splitNote("---\njust text\n---\n", parse)).toEqual({ raw: "just text", frontmatter: undefined, body: "" });
});

test("a path's folder and a story's name", () => {
  expect(folderOf("游戏/雨夜/main.ink")).toBe("游戏/雨夜/");
  expect(folderOf("main.ink")).toBe("");
  expect(storyName("游戏/雨夜/main.ink", "vault")).toBe("雨夜");
  expect(storyName("main.ink", "vault")).toBe("vault");
});
