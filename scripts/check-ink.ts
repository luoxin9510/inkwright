// Compile every .ink file under a folder (each as its own main story) and
// auto-play the first choice repeatedly (files INCLUDEd by another are skipped), reporting compile and runtime problems.
// With --all, play every branch instead (breadth-first) and list the endings reached; --lang zh|en
// picks the language of a bilingual story. A story with a game note (game.md) next to it is
// explored in game mode, once per character, walking the success and the failure of every check.
// Usage: npm run check-ink -- <folder> [--quiet] [--all] [--lang zh|en] [--max-steps N] [--states-per-spot N]
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { compileStory } from "../src/compile/compile";
import { resolveInclude, scanIncludes } from "../src/compile/paths";
import { playableCharacters, readConfig, type GameConfig } from "../src/game/config";
import { gameNote } from "./game-note";
import { T } from "../src/i18n";
import { exploreStory, type ExploreResult } from "../src/play/explore";
import { PlaySession } from "../src/play/session";

async function inkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await inkFiles(p)));
    else if (e.name.endsWith(".ink")) out.push(p);
  }
  return out.sort();
}

const root = process.argv[2];
const quiet = process.argv.includes("--quiet");
const all = process.argv.includes("--all");
const langAt = process.argv.indexOf("--lang");
const language = langAt >= 0 ? process.argv[langAt + 1] : undefined;
/** The number after a flag, or the default when the flag is missing or its value is not a number. */
function numberFlag(flag: string, fallback: number): number {
  const at = process.argv.indexOf(flag);
  const n = at >= 0 ? Number(process.argv[at + 1]) : NaN;
  if (at >= 0 && !Number.isFinite(n)) console.error(`${flag} needs a number; using ${fallback}`);
  return Number.isFinite(n) ? n : fallback;
}
const maxSteps = numberFlag("--max-steps", 20000);
const statesPerSpot = numberFlag("--states-per-spot", 10);
if (!root) {
  console.error("usage: check-ink <folder>");
  process.exit(2);
}

// Files pulled in by another file's INCLUDE are chapters, not main stories.
const files = await inkFiles(root);
const included = new Set<string>();
for (const file of files) {
  const rel = relative(root, file);
  for (const name of scanIncludes(await readFile(file, "utf8"))) included.add(resolveInclude(rel, name));
}

let failures = 0;
for (const file of files) {
  const rel = relative(root, file);
  if (included.has(rel)) continue;
  const r = await compileStory(rel, (p) => readFile(join(root, p), "utf8"));
  const problems = r.diagnostics.filter((d) => d.severity !== "todo");
  const runtime: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  let steps = 0;
  const endings: string[] = [];
  if (r.story && all) {
    // Game mode: one exploration per character, each walking both outcomes of every check.
    const note = await gameNote(file);
    let game: GameConfig | null = null;
    if (note?.error) warnings.push(`${note.name}: ${note.error}`);
    else if (note) {
      const read = readConfig(note.frontmatter);
      for (const p of read.problems) warnings.push(`${note.name}: ${T().configProblem(p)}`);
      game = read.config;
    }
    const runs: { tag: string; x: ExploreResult }[] = game
      ? playableCharacters(game).map((c) => ({ tag: `[${c.id}] `, x: exploreStory(r.story as NonNullable<typeof r.story>, { language, game: game as GameConfig, character: c.id, maxSteps, statesPerSpot }) }))
      : [{ tag: "", x: exploreStory(r.story, { language, maxSteps, statesPerSpot }) }];
    for (const { tag, x } of runs) {
      runtime.push(...x.errors.map((e) => `${tag}${e.message} (after: ${e.choices.join(" > ") || "start"})`));
      if (x.truncated) runtime.push(`${tag}stopped exploring after ${maxSteps} choices (endless loop, or raise --max-steps); not every branch was played`);
      endings.push(...x.endings.map((e) => `${tag}${e.lastText}  <- ${e.choices.join(" > ")}`));
      if (x.cappedSpots > 0) notes.push(`${tag}${x.cappedSpots} spot(s) reached in more states than played on (${statesPerSpot} each; raise --states-per-spot to play on more)`);
      for (const c of x.checks?.noConsequence ?? []) {
        warnings.push(`${tag}failing ${c.skill} ${c.difficulty} changes nothing (no variable, same choices): ${c.choices.join(" > ")}`);
      }
    }
  } else if (r.story) {
    const s = new PlaySession(r.story, { timeBudgetMs: 1000 });
    let step = s.start();
    runtime.push(...step.errors);
    while (!step.ended && step.choices.length > 0 && steps < 50) {
      step = s.choose(step.choices[0].index);
      runtime.push(...step.errors);
      steps++;
    }
  }
  const bad = problems.some((d) => d.severity === "error") || runtime.length > 0;
  if (bad) failures++;
  if (bad || problems.length > 0 || warnings.length > 0 || !quiet) {
    console.log(`${bad ? "FAIL" : problems.length || warnings.length ? "WARN" : "ok  "} ${rel} (${all ? `${endings.length} endings reached` : `${steps} choices played`})`);
    if (!quiet) for (const e of endings) console.log(`     [ending] ${e}`);
    if (!quiet) for (const n of notes) console.log(`     [note] ${n}`);
    for (const d of problems) console.log(`     [${d.severity}] ${relative(".", d.file)}:${d.line ?? "?"} ${d.message}`);
    for (const w of warnings) console.log(`     [warning] ${w}`);
    for (const e of runtime) console.log(`     [runtime] ${e}`);
  }
}
console.log(failures ? `\n${failures} file(s) with problems` : "\nall good");
process.exit(failures ? 1 : 0);
