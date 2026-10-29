// Obsidian's review rules (the same plugin the community-plugin review bot uses).
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  { ignores: ["main.js", "node_modules/", ".cache/", "tests/", "scripts/", "*.config.*", "esbuild.config.mjs"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ["eslint.config.mjs"] } },
    },
  },
]);
