import type { App } from "obsidian";
import { compileStory, type Flow } from "./compile/compile";
import type { Diagnostic } from "./compile/diagnostics";
import type { ReadFile } from "./compile/include";
import { T } from "./i18n";
import type { Inspection } from "./play/inspect";
import { pick, playScript, type ScriptOptions, type ScriptResult } from "./play/script";
import type { Choice } from "./play/session";
import type { PlayState } from "./views/PlayView";

export interface ApiHost {
  app: App;
  readFile: ReadFile;
  snapshot(): PlayState;
  refresh(): Promise<void>;
  openPlay(): Promise<void>;
  choose(index: number): void;
  restart(): void;
  startAt(path: string | null): void;
}

export interface ApiDiagnostic {
  severity: Diagnostic["severity"];
  file: string;
  line: number | null;
  message: string;
}

export interface CompileReport {
  ok: boolean;
  diagnostics: ApiDiagnostic[];
  flows: Flow[];
  files: string[];
}

export interface PlayReport extends ScriptResult {
  ok: boolean;
  diagnostics: ApiDiagnostic[];
}

export interface PanelReport extends Inspection {
  root: string | null;
  locked: string | null;
  startPoint: string | null;
  text: string[];
  choices: Choice[];
  ended: boolean;
  errors: string[];
  diagnostics: ApiDiagnostic[];
  flows: Flow[];
}

const HELP = `Inkwright agent API — app.plugins.plugins.inkwright.api
Paths are vault-relative, e.g. "游戏/雨夜来客/main.ink". Every method returns plain JSON (await it).

Headless (does not touch the visible panel):
  compile(path)                    -> { ok, diagnostics[{severity,file,line,message}], flows[{path,kind,file,line}], files }
  play(path, { from?, choices? })  -> { ok, diagnostics, transcript[{type:"text",text,tags}|{type:"choice",index,text}],
                                        choices, ended, errors, variables[{name,value}], visits[{path,count}], turns }
     from:    knot or "knot.stitch" to start at (default: the beginning)
     choices: list of choice indexes or texts (exact text first, then substring); stops at the first problem

Visible play panel (the user sees what you do):
  open(path?)          open a file (optional) and the play panel, recompile, return the panel
  panel()              current panel: { root, locked, startPoint, text[], choices, ended, errors, diagnostics, flows, variables, visits, turns }
  choose(indexOrText)  make a choice in the panel
  restart()            restart from the current start point
  startAt(path|null)   start the panel from a knot/stitch (null = beginning)

CLI example:
  obsidian vault=ink-games eval code='app.plugins.plugins.inkwright.api.play("游戏/雨夜来客/main.ink",{choices:[1,"油灯"]}).then(JSON.stringify)'`;

function plainDiagnostics(ds: Diagnostic[]): ApiDiagnostic[] {
  return ds.map(({ severity, file, line, message }) => ({ severity, file, line, message }));
}

export class InkwrightApi {
  constructor(private readonly host: ApiHost) {}

  help(): string {
    return HELP;
  }

  async compile(path: string): Promise<CompileReport> {
    const r = await compileStory(path, this.host.readFile);
    return { ok: r.ok, diagnostics: plainDiagnostics(r.diagnostics), flows: r.flows, files: r.files };
  }

  async play(path: string, options: ScriptOptions = {}): Promise<PlayReport> {
    const r = await compileStory(path, this.host.readFile);
    const diagnostics = plainDiagnostics(r.diagnostics);
    if (!r.story) {
      return {
        ok: false, diagnostics, transcript: [], choices: [], ended: true, errors: [],
        variables: [], visits: [], turns: 0,
      };
    }
    return { ok: true, diagnostics, ...playScript(r.story, options) };
  }

  async open(path?: string): Promise<PanelReport> {
    if (path) await this.host.app.workspace.openLinkText(path, "", false);
    await this.host.openPlay();
    await this.host.refresh();
    return this.panel();
  }

  panel(): PanelReport {
    const s = this.host.snapshot();
    const insp = s.inspection ?? { variables: [], visits: [], turns: 0 };
    return {
      root: s.root,
      locked: s.locked,
      startPoint: s.startPoint,
      text: s.log.map((p) => p.text),
      choices: s.choices,
      ended: s.ended,
      errors: s.runtimeErrors,
      diagnostics: plainDiagnostics(s.diagnostics),
      flows: s.flows,
      ...insp,
    };
  }

  choose(choice: number | string): PanelReport {
    const target = pick(this.host.snapshot().choices, choice);
    if (!target) {
      const report = this.panel();
      return { ...report, errors: [...report.errors, T().choiceNotFound(String(choice), report.choices.map((c) => c.text))] };
    }
    this.host.choose(target.index);
    return this.panel();
  }

  restart(): PanelReport {
    this.host.restart();
    return this.panel();
  }

  startAt(path: string | null): PanelReport {
    this.host.startAt(path);
    return this.panel();
  }
}
