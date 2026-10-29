// Obsidian's review rules (the same plugin the community-plugin review bot uses).
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // Lints src/ plus package.json (dependency replacements) and manifest.json (manifest rules).
  { ignores: ["main.js", "node_modules/", ".cache/", "tests/", "scripts/", "docs/", "*.config.*", "esbuild.config.mjs", "versions.json", "package-lock.json", "tsconfig.json"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ["eslint.config.mjs"] } },
    },
  },
]);
