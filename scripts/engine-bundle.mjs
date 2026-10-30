// The game engine (src/game/*) as one script for exported web pages: it defines the global
// `InkwrightGame`. Used by the plugin build and the tests (virtual:game-engine) and by export-web.
import esbuild from "esbuild";
import { fileURLToPath } from "node:url";

export async function engineBundle() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/game/browser.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "InkwrightGame",
    // The page's player reads window.InkwrightGame; the explicit assignment also works where the
    // script is not run at global scope (the tests evaluate it inside a function).
    footer: { js: "window.InkwrightGame = InkwrightGame;" },
    target: "es2017",
    minify: true,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}
