import { expect, test } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

/**
 * The exported page embeds findChoice's own source (findChoice.toString()). In a release build the plugin is
 * minified: the function must still run on its own, with nothing it refers to outside itself.
 */
test("findChoice's source still runs on its own after minifying, as the release build embeds it", async () => {
  const out = await build({
    entryPoints: [fileURLToPath(new URL("../src/play/match.ts", import.meta.url))],
    bundle: true, write: false, format: "iife", globalName: "M", minify: true, target: "es2020", platform: "browser", logLevel: "silent",
  });
  const bundled = new Function(`${out.outputFiles[0].text}; return M;`)() as { findChoice: (...a: unknown[]) => unknown };
  // The source alone, the way the page gets it: no module scope around it.
  const alone = new Function(`return (${bundled.findChoice.toString()});`)() as typeof bundled.findChoice;
  expect(alone(["新", "甲", "乙"], { index: 1, text: "乙" }, "match", true)).toEqual({ index: 2, guess: false });
  expect(alone(["付 5 金", "走开"], { index: 0, text: "付 3 金" }, "match", true)).toEqual({ index: 0, guess: true });
  expect(alone(["甲", "乙x", "丙"], { index: 1, text: "乙", offered: ["甲", "乙", "丙"] }, "match", true)).toEqual({ index: 1, guess: true });
  expect(alone(["甲"], { index: 1, text: "乙" }, "match", true)).toBeNull();
  expect(alone(["x", "y"], { index: 1, text: null }, "match", true)).toEqual({ index: 1, guess: false });
});
