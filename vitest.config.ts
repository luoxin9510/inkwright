import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { engineBundle } from "./scripts/engine-bundle.mjs";

export default defineConfig({
  plugins: [{
    // Same as the esbuild plugin in esbuild.config.mjs.
    name: "ink-runtime",
    resolveId: (id) => (id === "virtual:ink-runtime" ? "\0ink-runtime" : null),
    load: (id) => (id === "\0ink-runtime"
      ? `export default ${JSON.stringify(readFileSync("node_modules/inkjs/dist/ink.js", "utf8"))};`
      : null),
  }, {
    name: "game-engine",
    resolveId: (id) => (id === "virtual:game-engine" ? "\0game-engine" : null),
    load: async (id) => (id === "\0game-engine" ? `export default ${JSON.stringify(await engineBundle())};` : null),
  }],
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
