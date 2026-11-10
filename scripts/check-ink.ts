// Compile every .ink file under a folder (each as its own main story) and
// auto-play the first choice repeatedly (files INCLUDEd by another, and the ink of a rule-system pack, are skipped), reporting compile and runtime problems.
// With --all, play every branch instead (breadth-first) and list the endings reached, what was never
// reached (knots, choices) and resources that left their range; --lang zh|en picks the language of a
// bilingual story. A story with a game note (game.md) next to it is explored in game mode, once per
// character, walking the success and the failure of every check. --novelty plays on from a state only
// when something about it is new at its spot (long games stay finite without losing the counting paths);
// --novelty 2 also plays on from a pair of values first seen together there (slower, finds branches
// that need two things to agree); --random N also plays N runs at random with real dice and reports
// the odds of each ending and, in game mode, the spread of each resource at the end, how often each
// table row and each card came up (and which never did) and the success rate of each check.
// Usage: npm run check-ink -- <folder> [--quiet] [--all] [--novelty [N]] [--random N] [--seed S] [--lang zh|en] [--max-steps N] [--states-per-spot N]
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { compileStory } from "../src/compile/compile";
import { resolveInclude, scanIncludes } from "../src/compile/paths";
import { playableCharacters, type GameConfig } from "../src/game/config";
import { loadGameConfig } from "./game-note";
import { T } from "../src/i18n";
import { exploreStory, type ExploreResult } from "../src/play/explore";
import { PlaySession } from "../src/play/session";
import { simulateStory, type Spread } from "../src/play/simulate";

async function inkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  // A rule-system pack's folder (it has a system.md): its ink is INCLUDEd by the games on it, never played alone.
  const pack = entries.some((e) => e.isFile() && e.name === "system.md");
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (pack && e.isFile()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await inkFiles(p)));
    else if (e.name.endsWith(".ink")) out.push(p);
  }
  return out.sort();
}

const root = process.argv[2];
const quiet = process.argv.includes("--quiet");
const all = process.argv.includes("--all");
// --novelty [N]: N = 2 also plays on from a pair of values first seen together at a spot.
const noveltyAt = process.argv.indexOf("--novelty");
const noveltyOrder = noveltyAt >= 0 ? Number(process.argv[noveltyAt + 1]) : NaN;
const novelty: boolean | number = noveltyAt < 0 ? false : Number.isInteger(noveltyOrder) && noveltyOrder > 0 ? noveltyOrder : true;
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
    const loaded = await loadGameConfig(file);
    if (loaded?.note.error) warnings.push(`${loaded.note.name}: ${loaded.note.error}`);
    else if (loaded) {
      for (const p of loaded.problems) warnings.push(`${loaded.note.name}: ${T().configProblem(p)}`);
      game = loaded.config;
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
      if (x.sampled.length > 0) notes.push(`${tag}sampled, not every combination of cards: ${list(x.sampled.map((t) => `"${t}"`))}`);
      const cov = x.coverage;
      notes.push(`${tag}coverage: ${cov.places.reached.length}/${cov.places.total} places reached, ${cov.choices.taken}/${cov.choices.total} choices taken (${cov.choices.offered} offered); ${x.steps} choices played`);
      if (cov.places.missed.length > 0) warnings.push(`${tag}never reached: ${list(cov.places.missed)}`);
      const missed = cov.choices.missed.map((m) => (m.text !== null ? `"${m.text}" in ${m.place || "the start"}` : `an unoffered choice in ${m.place || "the start"}`));
      if (missed.length > 0) warnings.push(`${tag}never taken: ${list(missed)}`);
      for (const c of x.checks?.noConsequence ?? []) {
        warnings.push(`${tag}failing ${c.skill} ${c.difficulty} changes nothing (no variable, same choices): ${c.choices.join(" > ")}`);
      }
      for (const u of x.checks?.unknownNeeds ?? []) warnings.push(`${tag}choice "${u.choice}" needs an item the game note does not have: ${u.item}`);
      for (const u of x.checks?.unknownHands ?? []) warnings.push(`${tag}choice "${u.choice}" plays from a hand the game note does not have: ${u.hand}`);
      for (const l of x.checks?.lockedOut ?? []) runtime.push(`${tag}stuck: every choice needs an item not carried (after: ${l.choices.join(" > ") || "start"})`);
      for (const o of x.checks?.outOfRange ?? []) warnings.push(`${tag}${o.resource} pushed to ${o.value}, outside ${o.min}..${o.max} and clamped (after: ${o.choices.join(" > ") || "start"})`);
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
      const pct = (n: number, of: number) => `${of > 0 ? Math.round((100 * n) / of) : 0}%`;
      const per = (n: number) => `${Math.round(n * 10) / 10} per run`;
      for (const res of x.resources ?? []) {
        const p = res.percentiles;
        const bounds = [res.atMin > 0 ? `${res.atMin} run(s) end at the lowest` : "", res.atMax > 0 ? `${res.atMax} at the highest` : ""].filter(Boolean);
        notes.push(`${tag}  ${res.resource} at the end: ${range(res.end)}${res.end.min === res.end.max ? "" : `; p10 ${p.p10}, median ${p.p50}, p90 ${p.p90}`}${bounds.length ? `; ${bounds.join(", ")}` : ""}${res.outOfRange > 0 ? `; pushed out of range in ${res.outOfRange} run(s)` : ""}`);
      }
      for (const t of x.tables ?? []) {
        // A row is named by its id, else by the start of its text.
        const short = (s: string) => ([...s].length > 10 ? `${[...s].slice(0, 10).join("")}…` : s);
        const rows = t.rows.map((r) => `${r.range} ${r.id ?? short(r.text)} ${r.count > 0 ? pct(r.count, t.rolls) : "never"}`.replace(/\s+/g, " "));
        notes.push(`${tag}  table ${t.table}${t.name !== t.table ? ` (${t.name})` : ""}: ${t.rolls} roll(s), ${per(t.perRun)}${t.rolls > 0 ? ` — ${list(rows, 20)}` : ""}${t.none > 0 ? `; ${t.none} total(s) on no row` : ""}`);
      }
      for (const d of x.decks ?? []) {
        const drawn = d.cards.filter((c) => c.count > 0).map((c) => `${c.name} ${pct(c.count, d.draws)}`);
        const never = d.cards.filter((c) => c.count === 0).map((c) => c.name);
        notes.push(`${tag}  deck ${d.deck}${d.name !== d.deck ? ` (${d.name})` : ""}: ${d.draws} draw(s), ${per(d.perRun)}${drawn.length ? ` — ${list(drawn, 20)}` : ""}${never.length && d.draws > 0 ? `; never drawn: ${list(never)}` : ""}`);
      }
      for (const c of x.checks ?? []) notes.push(`${tag}  check ${c.skill} ${c.difficulty}: ${c.count} roll(s), ${pct(c.success * c.count, c.count)} success`);
      for (const k of x.kinds ?? []) {
        const came = k.templates.filter((t) => t.spawned > 0).map((t) => {
          const fate = [t.removed > 0 ? `${t.removed} out after ~${Math.round(t.turns * 10) / 10} choices` : "", t.left > 0 ? `${t.left} left at the end` : ""].filter(Boolean);
          return `${t.name} ${t.spawned} (${fate.join(", ")})`;
        });
        const never = k.templates.filter((t) => t.spawned === 0).map((t) => t.name);
        notes.push(`${tag}  kind ${k.kind}${k.name !== k.kind ? ` (${k.name})` : ""}: ${came.length ? list(came, 20) : "none spawned"}${never.length && came.length ? `; never spawned: ${list(never)}` : ""}; most at once ${range(k.most)}`);
        if (k.overMax > 0) warnings.push(`${tag}kind ${k.kind}: ${k.overMax} entity stat(s) went above their max in random runs`);
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
