import { Compiler, CompilerOptions, type Story } from "inkjs/full";
import { T } from "../i18n";
import { parseRaw, translate, type Diagnostic } from "./diagnostics";
import { CachedFileHandler, preload, type ReadFile } from "./include";
import { resolveInclude } from "./paths";

export interface CompileResult {
  ok: boolean;
  story: Story | null;
  diagnostics: Diagnostic[];
  files: string[];
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
    basename(rootPath), [], false, onError, new CachedFileHandler(rootPath, cache),
  );

  let story: Story | null = null;
  try {
    story = new Compiler(rootSource, options).Compile();
  } catch (e) {
    if (!diagnostics.some((d) => d.severity === "error")) {
      const raw = e instanceof Error ? e.message : String(e);
      diagnostics.push({ severity: "error", file: rootPath, line: null, message: translate(raw), raw });
    }
  }

  const ok = !diagnostics.some((d) => d.severity === "error");
  return { ok, story: ok ? story : null, diagnostics, files };
}
