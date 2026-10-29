import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  plugins: [inkRuntime],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
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
