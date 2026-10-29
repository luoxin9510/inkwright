import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [{
    // Same as the esbuild plugin in esbuild.config.mjs.
    name: "ink-runtime",
    resolveId: (id) => (id === "virtual:ink-runtime" ? "\0ink-runtime" : null),
    load: (id) => (id === "\0ink-runtime"
      ? `export default ${JSON.stringify(readFileSync("node_modules/inkjs/dist/ink.js", "utf8"))};`
      : null),
  }],
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
