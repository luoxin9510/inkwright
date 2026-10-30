// Export a main story as a standalone web page, like the plugin's "Export as web page" command.
// A story with a game note (game.md) next to it gets the game engine: character picker, HUD, checks, dice.
// Usage: npm run export-web -- <main.ink> <out.html> [--lang zh|en] [--id <storage key>]
// --lang sets the page's button language (default zh); bilingual stories still get their language switch.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { compileStory } from "../src/compile/compile";
import { buildWebPage, storyTitle } from "../src/export/web";
import { readConfig } from "../src/game/config";
import { setLanguage, T } from "../src/i18n";
import { findLanguageVar } from "../src/play/session";
import { engineBundle } from "./engine-bundle.mjs";
import { gameNote } from "./game-note";

const [file, out] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const option = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (!file || !out) {
  console.error("usage: export-web <main.ink> <out.html> [--lang zh|en] [--id <storage key>]");
  process.exit(2);
}
setLanguage(option("lang") === "en" ? "en" : "zh");

const dir = dirname(file);
const r = await compileStory(basename(file), (p) => readFile(join(dir, p), "utf8"));
for (const d of r.diagnostics) console.error(`[${d.severity}] ${d.file}:${d.line ?? "?"} ${d.message}`);
if (!r.story) process.exit(1);

// Game mode when a usable game note sits next to the story.
const note = await gameNote(file);
let game = undefined;
if (note?.error) console.error(`[warning] ${note.name}: ${note.error}`);
else if (note) {
  const read = readConfig(note.frontmatter);
  for (const p of read.problems) console.error(`[warning] ${note.name}: ${T().configProblem(p)}`);
  game = read.config ?? undefined;
}

// Same fallback as the plugin: main.ink is named after its folder.
const name = basename(file, ".ink");
const fallback = name.toLowerCase() === "main" ? basename(dir === "." ? process.cwd() : dir) : name;
const html = buildWebPage({
  title: storyTitle(r.story.globalTags, fallback),
  storyJson: r.story.ToJson() as string,
  runtime: await readFile(new URL("../node_modules/inkjs/dist/ink.js", import.meta.url), "utf8"),
  id: option("id") ?? file,
  languageVar: findLanguageVar(r.story),
  game,
  engine: game ? await engineBundle() : undefined,
});
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`exported ${file} -> ${out}`);
