import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { engineBundle } from "./scripts/engine-bundle.mjs";

const production = process.argv[2] === "production";
const outDir = process.env.OBSIDIAN_PLUGIN_DIR || ".";

// The inkjs runtime as text, embedded into exported web pages (src/export/web.ts).
const inkRuntime = {
  name: "ink-runtime",
  setup(build) {
    build.onResolve({ filter: /^virtual:ink-runtime$/ }, () => ({ path: "ink-runtime", namespace: "ink-runtime" }));
    build.onLoad({ filter: /.*/, namespace: "ink-runtime" }, () => ({
      contents: readFileSync("node_modules/inkjs/dist/ink.js", "utf8"),
      loader: "text",
    }));
  },
};

// The game engine as a script for exported pages (src/export/web.ts), bundled by scripts/engine-bundle.mjs.
const gameEngine = {
  name: "game-engine",
  setup(build) {
    build.onResolve({ filter: /^virtual:game-engine$/ }, () => ({ path: "game-engine", namespace: "game-engine" }));
    build.onLoad({ filter: /.*/, namespace: "game-engine" }, async () => ({ contents: await engineBundle(), loader: "text" }));
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  plugins: [inkRuntime, gameEngine],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  outfile: join(outDir, "main.js"),
});

function copyAssets() {
  if (outDir === ".") return;
  mkdirSync(outDir, { recursive: true });
  for (const f of ["manifest.json", "styles.css"]) copyFileSync(f, join(outDir, f));
}

if (production) {
  await ctx.rebuild();
  copyAssets();
  await ctx.dispose();
} else {
  copyAssets();
  await ctx.watch();
}
