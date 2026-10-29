// Compile every .ink file under a folder (each as its own main story) and
// auto-play the first choice repeatedly (files INCLUDEd by another are skipped), reporting compile and runtime problems.
// Usage: npm run check-ink -- <folder> [--quiet]
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { compileStory } from "../src/compile/compile";
import { resolveInclude, scanIncludes } from "../src/compile/paths";
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
if (!root) {
  console.error("usage: check-ink <folder>");
  process.exit(2);
}

// Files pulled in by another file's INCLUDE are chapters, not main stories.
const all = await inkFiles(root);
const included = new Set<string>();
for (const file of all) {
  const rel = relative(root, file);
  for (const name of scanIncludes(await readFile(file, "utf8"))) included.add(resolveInclude(rel, name));
}

let failures = 0;
for (const file of all) {
  const rel = relative(root, file);
  if (included.has(rel)) continue;
  const r = await compileStory(rel, (p) => readFile(join(root, p), "utf8"));
  const problems = r.diagnostics.filter((d) => d.severity !== "todo");
  let runtime: string[] = [];
  let steps = 0;
  if (r.story) {
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
  if (bad || problems.length > 0 || !quiet) {
    console.log(`${bad ? "FAIL" : problems.length ? "WARN" : "ok  "} ${rel} (${steps} choices played)`);
    for (const d of problems) console.log(`     [${d.severity}] ${relative(".", d.file)}:${d.line ?? "?"} ${d.message}`);
    for (const e of runtime) console.log(`     [runtime] ${e}`);
  }
}
console.log(failures ? `\n${failures} file(s) with problems` : "\nall good");
process.exit(failures ? 1 : 0);
