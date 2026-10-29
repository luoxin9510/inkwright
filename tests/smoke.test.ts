import { expect, test } from "vitest";
import { Compiler } from "inkjs/full";

test("inkjs/full exposes the Compiler", () => {
  expect(typeof Compiler).toBe("function");
});
