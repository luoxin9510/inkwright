// Write the engine ink a game INCLUDEs (`_engine.ink` by default, `engineFile` in the note) from the
// game note next to a main story, with its `from:` tables, decks and canvas resolved from disk: the
// command-line twin of the plugin's "Generate game engine ink" / `api.generateEngine()`, for repos
// that keep the engine committed and check it in CI.
// Usage: npm run gen-engine -- <main.ink> [--check]   (--check: exit 1 when the file on disk differs, writing nothing)
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { engineFile } from "../src/game/config";
import { generateInk } from "../src/game/inkgen";
import { T } from "../src/i18n";
import { loadGameConfig } from "./game-note";

const file = process.argv[2];
const check = process.argv.includes("--check");
if (!file) {
  console.error("usage: gen-engine <main.ink> [--check]");
  process.exit(2);
}
const loaded = await loadGameConfig(file);
if (!loaded) {
  console.error(`no game note next to ${file}`);
  process.exit(2);
}
if (loaded.note.error) {
  console.error(`${loaded.note.name}: ${loaded.note.error}`);
  process.exit(1);
}
for (const p of loaded.problems) console.error(`${loaded.note.name}: ${T().configProblem(p)}`);
if (!loaded.config) process.exit(1);
const out = join(dirname(file), engineFile(loaded.config));
const ink = generateInk(loaded.config);
const current = await readFile(out, "utf8").catch(() => null);
if (check) {
  if (current === ink) console.log(`ok   ${out} matches the note`);
  else console.error(`FAIL ${out} ${current === null ? "is missing" : "differs from what the note generates"}; run gen-engine without --check`);
  process.exit(current === ink ? 0 : 1);
}
await writeFile(out, ink, "utf8");
console.log(`${current === ink ? "unchanged" : current === null ? "written  " : "updated  "} ${out}`);
