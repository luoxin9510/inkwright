import { Compiler, CompilerOptions, type Story } from "inkjs/full";
import { T } from "../i18n";
import { parseRaw, translate, type Diagnostic } from "./diagnostics";
import { CachedFileHandler, preload, type ReadFile } from "./include";
import { resolveInclude } from "./paths";

/** A place the player can start from: a knot or a stitch (functions excluded). */
export interface Flow {
  path: string;
  kind: "knot" | "stitch";
  file: string;
  line: number | null;
}

export interface CompileResult {
  ok: boolean;
  story: Story | null;
  diagnostics: Diagnostic[];
  files: string[];
  flows: Flow[];
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export async function compileStory(rootPath: string, readFile: ReadFile): Promise<CompileResult> {
  const cache = await preload(rootPath, readFile);
  const files = [...cache.files.keys(), ...cache.missing];

  const rootSource = cache.files.get(rootPath);
  if (rootSource === undefined) {
    return {
      ok: false,
      story: null,
      files,
      flows: [],
      diagnostics: [{
        severity: "error", file: rootPath, line: null,
        message: T().missingRoot(rootPath), raw: "",
      }],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const onError = (raw: string): void => {
    const p = parseRaw(raw);
    diagnostics.push({
      severity: p.severity,
      file: p.file ? resolveInclude(rootPath, p.file) : rootPath,
      line: p.line,
      // TODO notes are the author's own words, not compiler errors to translate.
      message: p.severity === "todo" ? T().todo(p.text) : translate(p.text),
      raw,
    });
  };

  const options = new CompilerOptions(
    // countAllVisits: the variable panel shows visit counts for every knot and stitch.
    basename(rootPath), [], true, onError, new CachedFileHandler(rootPath, cache),
  );

  let story: Story | null = null;
  const compiler = new Compiler(rootSource, options);
  try {
    story = compiler.Compile();
  } catch (e) {
    if (!diagnostics.some((d) => d.severity === "error")) {
      const raw = e instanceof Error ? e.message : String(e);
      diagnostics.push({ severity: "error", file: rootPath, line: null, message: translate(raw), raw });
    }
  }

  const ok = !diagnostics.some((d) => d.severity === "error");
  return { ok, story: ok ? story : null, diagnostics, files, flows: ok ? listFlows(compiler, rootPath) : [] };
}

interface ParsedFlow {
  isFunction: boolean;
  identifier: { name: string | null } | null;
  subFlowsByName: Map<string, ParsedFlow>;
  debugMetadata: { fileName: string | null; startLineNumber: number } | null;
}

function listFlows(compiler: Compiler, rootPath: string): Flow[] {
  const flows: Flow[] = [];
  const where = (f: ParsedFlow) => ({
    file: f.debugMetadata?.fileName ? resolveInclude(rootPath, f.debugMetadata.fileName) : rootPath,
    line: f.debugMetadata ? f.debugMetadata.startLineNumber : null,
  });
  const story = compiler.parsedStory as unknown as ParsedFlow;
  for (const knot of story.subFlowsByName.values()) {
    if (knot.isFunction || !knot.identifier?.name) continue;
    flows.push({ path: knot.identifier.name, kind: "knot", ...where(knot) });
    for (const stitch of knot.subFlowsByName.values()) {
      if (!stitch.identifier?.name) continue;
      flows.push({ path: `${knot.identifier.name}.${stitch.identifier.name}`, kind: "stitch", ...where(stitch) });
    }
  }
  return flows;
}
