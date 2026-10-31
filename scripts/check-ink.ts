// Compile every .ink file under a folder (each as its own main story) and
// auto-play the first choice repeatedly (files INCLUDEd by another are skipped), reporting compile and runtime problems.
// With --all, play every branch instead (breadth-first) and list the endings reached, what was never
// reached (knots, choices) and resources that left their range; --lang zh|en picks the language of a
// bilingual story. A story with a game note (game.md) next to it is explored in game mode, once per
// character, walking the success and the failure of every check. --novelty plays on from a state only
// when something about it is new at its spot (long games stay finite without losing the counting paths);
// --random N also plays N runs at random with real dice and reports the odds of each ending.
// Usage: npm run check-ink -- <folder> [--quiet] [--all] [--novelty] [--random N] [--seed S] [--lang zh|en] [--max-steps N] [--states-per-spot N]
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { compileStory } from "../src/compile/compile";
import { resolveInclude, scanIncludes } from "../src/compile/paths";
import { playableCharacters, readConfig, type GameConfig } from "../src/game/config";
import { gameNote } from "./game-note";
import { T } from "../src/i18n";
import { exploreStory, type ExploreResult } from "../src/play/explore";
import { PlaySession } from "../src/play/session";
import { simulateStory, type Spread } from "../src/play/simulate";

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
const novelty = process.argv.includes("--novelty");
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
const randomRuns = numberFlag("--random", 0);
const seed = numberFlag("--seed", 1);
if (!root) {
  console.error("usage: check-ink <folder>");
  process.exit(2);
}

/** Up to `n` items, then "+k more". */
function list(items: string[], n = 12): string {
  return items.length <= n ? items.join(", ") : `${items.slice(0, n).join(", ")} +${items.length - n} more`;
}
function range(s: Spread): string {
  return s.min === s.max ? `${s.min}` : `${s.min}..${s.max} (mean ${Math.round(s.mean * 10) / 10})`;
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
  // Knots no chain of diverts leads to: dead text, or a divert that was never written.
  for (const n of r.graph?.nodes ?? []) {
    if (!n.reachable && n.kind !== "end" && n.kind !== "start") warnings.push(`unreachable: ${n.id} (${n.file ?? "?"}:${n.line ?? "?"})`);
  }
  // Game mode: one exploration per character, each walking both outcomes of every check.
  let game: GameConfig | null = null;
  if (r.story && (all || randomRuns > 0)) {
    const note = await gameNote(file);
    if (note?.error) warnings.push(`${note.name}: ${note.error}`);
    else if (note) {
      const read = readConfig(note.frontmatter);
      for (const p of read.problems) warnings.push(`${note.name}: ${T().configProblem(p)}`);
      game = read.config;
    }
  }
  const characters = game ? playableCharacters(game).map((c) => ({ tag: `[${c.id}] `, character: c.id })) : [{ tag: "", character: undefined }];
  if (r.story && all) {
    const story = r.story;
    const runs: { tag: string; x: ExploreResult }[] = characters.map(({ tag, character }) => ({
      tag, x: exploreStory(story, { language, game: game ?? undefined, character, maxSteps, statesPerSpot, novelty }),
    }));
    for (const { tag, x } of runs) {
      runtime.push(...x.errors.map((e) => `${tag}${e.message} (after: ${e.choices.join(" > ") || "start"})`));
      if (x.truncated) runtime.push(`${tag}stopped exploring after ${maxSteps} choices (endless loop, or raise --max-steps); not every branch was played`);
      endings.push(...x.endings.map((e) => `${tag}${e.lastText}  <- ${e.choices.join(" > ")}`));
      if (x.cappedSpots > 0) notes.push(`${tag}${x.cappedSpots} spot(s) reached in more states than played on (${statesPerSpot} each; raise --states-per-spot, or use --novelty)`);
      const cov = x.coverage;
      notes.push(`${tag}coverage: ${cov.places.reached.length}/${cov.places.total} places reached, ${cov.choices.taken}/${cov.choices.total} choices taken (${cov.choices.offered} offered)`);
      if (cov.places.missed.length > 0) warnings.push(`${tag}never reached: ${list(cov.places.missed)}`);
      const missed = cov.choices.missed.map((m) => (m.text !== null ? `"${m.text}" in ${m.place || "the start"}` : `an unoffered choice in ${m.place || "the start"}`));
      if (missed.length > 0) warnings.push(`${tag}never taken: ${list(missed)}`);
      for (const c of x.checks?.noConsequence ?? []) {
        warnings.push(`${tag}failing ${c.skill} ${c.difficulty} changes nothing (no variable, same choices): ${c.choices.join(" > ")}`);
      }
      for (const u of x.checks?.unknownNeeds ?? []) warnings.push(`${tag}choice "${u.choice}" needs an item the game note does not have: ${u.item}`);
      for (const l of x.checks?.lockedOut ?? []) runtime.push(`${tag}stuck: every choice needs an item not carried (after: ${l.choices.join(" > ") || "start"})`);
      for (const o of x.checks?.outOfRange ?? []) warnings.push(`${tag}${o.resource} = ${o.value}, outside ${o.min}..${o.max} (after: ${o.choices.join(" > ") || "start"})`);
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
  if (r.story && randomRuns > 0) {
    const story = r.story;
    for (const { tag, character } of characters) {
      const x = simulateStory(story, { runs: randomRuns, seed, language, game: game ?? undefined, character });
      runtime.push(...x.errors.map((e) => `${tag}${e.message} (in ${e.count} random run(s); after: ${e.choices.join(" > ") || "start"})`));
      const extra = [x.truncated > 0 ? `${x.truncated} ran out of steps` : "", x.stuck > 0 ? `${x.stuck} got stuck` : ""].filter(Boolean);
      notes.push(`${tag}${x.runs} random runs (seed ${seed}): ${range(x.steps)} choices each${extra.length ? "; " + extra.join("; ") : ""}`);
      for (const e of x.endings) notes.push(`${tag}  ${Math.round((100 * e.count) / x.runs)}% (${e.count}) ${e.lastText}  after ~${Math.round(e.steps)} choices`);
      for (const res of x.resources ?? []) {
        notes.push(`${tag}  ${res.resource} at the end: ${range(res.end)}${res.outOfRange > 0 ? `; out of range in ${res.outOfRange} run(s)` : ""}`);
      }
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
