import { describe, expect, test } from "vitest";
import { tokenizeLine } from "../src/editor/tokenize";

describe("tokenizeLine", () => {
  test("knot header covers the whole line, Chinese included", () => {
    expect(tokenizeLine("=== 第一章 ===")).toEqual([{ from: 0, to: 11, kind: "knot" }]);
  });
  test("stitch header", () => {
    expect(tokenizeLine("= 小节")).toEqual([{ from: 0, to: 4, kind: "stitch" }]);
  });
  test("line comment", () => {
    expect(tokenizeLine("// hi")).toEqual([{ from: 0, to: 5, kind: "comment" }]);
  });
  test("trailing comment after text", () => {
    expect(tokenizeLine("text // note")).toEqual([{ from: 5, to: 12, kind: "comment" }]);
  });
  test("choice marker and divert", () => {
    expect(tokenizeLine("* [Go] text -> next")).toEqual([
      { from: 0, to: 1, kind: "choice" },
      { from: 12, to: 19, kind: "divert" },
    ]);
  });
  test.each(["VAR", "CONST", "LIST", "INCLUDE", "EXTERNAL"])("%s keyword", (kw) => {
    expect(tokenizeLine(`${kw} x = 3`)).toEqual([{ from: 0, to: kw.length, kind: "keyword" }]);
  });
  test("logic line", () => {
    expect(tokenizeLine("~ hp = hp - 1")).toEqual([{ from: 0, to: 13, kind: "logic" }]);
  });
  test("tag", () => {
    expect(tokenizeLine("plain text #tag")).toEqual([{ from: 11, to: 15, kind: "tag" }]);
  });
  test("a divert arrow is not a gather", () => {
    expect(tokenizeLine("-> end")).toEqual([{ from: 0, to: 6, kind: "divert" }]);
  });
  test("empty line", () => {
    expect(tokenizeLine("")).toEqual([]);
  });
});
