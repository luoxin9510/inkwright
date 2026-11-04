import type { App } from "obsidian";
import { compileStory, type Flow } from "./compile/compile";
import type { GraphEdge, GraphNode } from "./compile/graph";
import type { Diagnostic } from "./compile/diagnostics";
import type { ReadFile } from "./compile/include";
import { T } from "./i18n";
import type { Inspection } from "./play/inspect";
import { inputOf } from "./play/input";
import { pick, playScript, type ScriptOptions, type ScriptResult } from "./play/script";
import { exploreStory, type ExploreOptions, type ExploreResult } from "./play/explore";
import { simulateStory, type SimulateOptions, type SimulateResult } from "./play/simulate";
import type { ChoiceCheck, ChoicePlay, GridView, HudView, MapView, RollRecord, ChoiceNeed } from "./game/engine";
import type { ConfigProblem, GameConfig } from "./game/config";
import type { Choice } from "./play/session";
import type { Run } from "./play/run";
import type { PlayState } from "./views/PlayView";

export interface ApiHost {
  app: App;
  readFile: ReadFile;
  snapshot(): PlayState;
  refresh(): Promise<void>;
  openPlay(): Promise<void>;
  /** Takes a choice; `value` is the card id for a `#play` choice or the text typed for an `#input` one. */
  choose(index: number, value?: string): void;
  restart(): void;
  startAt(path: string | null): void;
  back(): void;
  setStoryLanguage(lang: string): void;
  selectCharacter(id: string): void;
  saveGame(name?: string): Promise<{ id: string; name: string; savedAt: string } | null>;
  loadGame(id: string): void;
  deleteSave(id: string): Promise<void>;
  exportWeb(path?: string | null): Promise<{ path: string | null; diagnostics: Diagnostic[] }>;
  generateEngine(path?: string | null): Promise<{ path: string | null; problems: ConfigProblem[] }>;
  /** The usable game config next to a story (its note-kept tables read in), or null. */
  gameConfigFor(path: string): Promise<GameConfig | null>;
  writeJournal(): Promise<{ path: string | null }>;
  savesForRoot(): { id: string; name: string; savedAt: string }[];
  /** The run the panel plays (its record of actions); null when there is none. */
  currentRun(): Run | null;
  /** Every saved run of the current main story, draft included. */
  runsForRoot(): Promise<Run[]>;
  exportRun(): Promise<{ path: string | null }>;
  importRun(path: string): Promise<{ id: string; name: string } | null>;
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

export interface GraphReport {
  ok: boolean;
  diagnostics: ApiDiagnostic[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Knots/stitches no chain of diverts reaches from the start. */
  unreachable: string[];
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
  /** Language of a bilingual story; null when the story is not bilingual. */
  language: string | null;
  /** The latest choice of the run: its text and the index in `text` of the first paragraph it produced; null after start, undo or load. */
  chosen: { text: string; at: number } | null;
  /** Whether the panel's top bar is pinned. */
  pinned: boolean;
  /** A saved run being picked up (replayed); null when none is. The panel takes no choices meanwhile. */
  replay: { done: number; total: number } | null;
  /** Why the run stopped short of where it had got to (the story changed, a step failed, too long, start point or character gone); null when it did not. */
  stopped: { reason: string; step: number; pending: number; detail?: string } | null;
  /** Game mode: the current character, check info per choice, resources and companions, dice log. */
  game: { character: string | null; checks: (ChoiceCheck | null)[]; needs: ChoiceNeed[][]; plays: (ChoicePlay | null)[]; hud: HudView; map: MapView | null; dungeon: GridView | null; rolls: RollRecord[] } | null;
}

const HELP = `Inkwright agent API — app.plugins.plugins.inkwright.api
Paths are vault-relative, e.g. "游戏/雨夜来客/main.ink". Every method returns plain JSON (await it).

Headless (does not touch the visible panel):
  compile(path)                    -> { ok, diagnostics[{severity,file,line,message}], flows[{path,kind,file,line}], files }
  graph(path)                      -> { ok, diagnostics, nodes[{id,kind,file,line,reachable}], edges[{from,to,kind,count}], unreachable[] }
     node ids: knot / "knot.stitch", plus "@start" and "@end"; edge kind: divert | tunnel | thread | fall
  play(path, { from?, choices?, language? })  -> { ok, diagnostics, transcript[{type:"text",text,tags}|{type:"choice",index,text,input?}],
                                        choices, ended, errors, variables[{name,value}], visits[{path,count}], turns }
     from:    knot or "knot.stitch" to start at (default: the beginning)
     choices: list of choice indexes or texts (exact text first, then substring); stops at the first problem.
              An #input:var choice (the player types a line into a string VAR) takes { choice, text };
              given as a plain index or text it types the placeholder "[var]".
              Any choice can be picked, including one the panel shows locked (#needs: item not carried).
     language: "zh" | "en" for a bilingual story (VAR 语言 or VAR lang); default: the story's own value
  explore(path, { language?, maxSteps?, statesPerSpot?, novelty?, character?, bands? })
                       -> { ok, diagnostics, endings[{choices[],lastText}], errors[{choices[],message}], truncated, cappedSpots, coverage, checks? }
     plays every branch breadth-first (default limit 5000 choices); use it to check that all endings work.
     A state reached before is not played on again; a spot (the same choices offered) is played on from
     at most statesPerSpot states (default 10; cappedSpots counts the spots where that cut branches off).
     novelty:true instead plays on from a state only when something about it is new at its spot (a value of a
     variable that can change what happens next, a sequence's count): a long game stays finite and the
     counting paths (a resource worn down to a threshold) are kept. novelty:2 judges again within each value of a
     gate (a variable a choice condition reads), so a branch two things must agree on is reached (slower). coverage = { places{total,reached[],missed[]},
     choices{total,offered,taken,missed[{place,text}]} } says which knots/stitches/labels and choices were never got to.
     Game mode (game.md next to the story): every check is walked as success and failure (bands [3,1] by
     default; pass bands:[4,3,2,1,0] for all), paths show the outcome ("撬开门 [strength✗]"), and
     checks = { walked, noConsequence[{choices[], skill, difficulty}], unknownNeeds, lockedOut, outOfRange[{choices[], resource, value, min, max}] }:
     failed checks after which no variable and no choice changed, and resources that left their min..max;
     character picks the PC (default: the first)
  simulate(path, { runs?, seed?, maxSteps?, language?, character? })
                       -> { ok, diagnostics, runs, endings[{lastText, count, steps}], truncated, stuck, errors[{message,count,choices[]}], steps{min,mean,max}, resources?[{resource, end{min,mean,max}, percentiles{p10,p50,p90}, atMin, atMax, outOfRange}],
                          tables?[{table, name, rolls, perRun, rows[{range, id?, text, count}], none}], decks?[{deck, name, draws, perRun, cards[{id, name, count}]}],
                          checks?[{skill, difficulty, count, success}] }
     plays the story runs times (default 100) choosing at random, with real dice in game mode (the same seed
     repeats the runs): the odds of each ending and where the resources end up, for balancing; in game mode also how often
     each table row and each card came up (0 = never) and each check's success rate.

Visible play panel (the user sees what you do):
  open(path?)          open a file (optional) and the play panel, recompile, return the panel
  panel()              current panel: { root, locked, startPoint, text[], choices, ended, errors, diagnostics, flows, language, game, variables, visits, turns,
                         chosen (the latest choice: { text, at = index of the first paragraph it produced } or null), pinned }
                       game (when the story's folder has a game.md): { character, checks[per choice: skill, difficulty, red, level, modifiers, chance],
                         needs[per choice: items it needs, each { id, name, has, known }; a missing one locks the choice],
                         plays[per choice: the hand a #play choice takes a card from, { hand, name, cards[{ id, name, desc, deck }], known }],
                         hud (resources, companions, items carried, decks, hands, party: members with title, stats, gear, down), map (places with here/revealed/counter/go, tokens), dungeon (the growing dungeon: rooms with squares, doors and marks, walls, free doors left), rolls }
  choose(indexOrText, value?)  make a choice in the panel; a #play choice needs the id of a card in its hand,
                       an #input choice the text to type
  restart()            restart from the current start point
  startAt(path|null)   start the panel from a knot/stitch (null = beginning)
  back()               undo the last choice in the panel
  language("zh"|"en")  switch a bilingual story's language; replays the run so far in it
  character(id)        game mode: play as this character (restarts from the current start point)
  save(name?)          save the panel's run as a run of its own (a snapshot) -> { id, name, savedAt } | null
  saves()              saved runs of the current main story [{ id, name, savedAt }], newest first
  load(idOrName)       load a saved run into the panel (it replays; the save itself is not changed)
  deleteSave(idOrName) delete a saved run
  run()                the run the panel plays: { id, story, startPoint, character, seeds, seqNext, actions[{kind, seq, lang, index, text, payload?, fp}], pending? }
                       (saved in the vault: <save folder>/<story>/<run id>/<device>.json; resumed by replaying actions, see docs/solo-prd.md)
  runs()               every run of the current main story, draft included -> [{ id, name, draft, updatedAt, actions, conflictOf? }]
  panel() also has replay ({done,total} while a saved run is being picked up) and stopped (why it stopped short).
  exportRun()          write the panel's run to <save folder>/导出/<story> <time>.json -> { path }
  importRun(path)      import an exported run file as a save of the current story -> { id, name } | null

Export:
  exportWeb(path?)     write the story as one standalone .html next to it (main.ink -> <folder>.html)
                       -> { ok, path, diagnostics }; path defaults to the panel's main story
  generateEngine(path?) game mode: write the engine ink (variables, character presets, check fallback, dice and
                       tables) from the story's game.md next to it (default _engine.ink) -> { ok, path, problems[] }
  journal()            write the panel's run so far (text, choices, rolls) as a markdown note; the path comes from
                       game.md's journal.path (default {dir}日志/{date} {time}.md) -> { ok, path }

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

  async exportWeb(path?: string): Promise<{ ok: boolean; path: string | null; diagnostics: ApiDiagnostic[] }> {
    const r = await this.host.exportWeb(path);
    return { ok: r.path !== null, path: r.path, diagnostics: plainDiagnostics(r.diagnostics) };
  }

  async generateEngine(path?: string): Promise<{ ok: boolean; path: string | null; problems: string[] }> {
    const r = await this.host.generateEngine(path);
    return { ok: r.path !== null, path: r.path, problems: r.problems.map((p) => T().configProblem(p)) };
  }

  async journal(): Promise<{ ok: boolean; path: string | null }> {
    const r = await this.host.writeJournal();
    return { ok: r.path !== null, path: r.path };
  }

  async explore(path: string, options: ExploreOptions = {}): Promise<ExploreResult & { ok: boolean; diagnostics: ApiDiagnostic[] }> {
    const r = await compileStory(path, this.host.readFile);
    const diagnostics = plainDiagnostics(r.diagnostics);
    if (!r.story) {
      return {
        ok: false, diagnostics, endings: [], errors: [], truncated: false, steps: 0, cappedSpots: 0,
        coverage: { places: { total: 0, reached: [], missed: [] }, choices: { total: 0, offered: 0, taken: 0, missed: [] } },
      };
    }
    const game = options.game ?? (await this.host.gameConfigFor(path)) ?? undefined;
    return { ok: true, diagnostics, ...exploreStory(r.story, { ...options, game }) };
  }

  async simulate(path: string, options: SimulateOptions = {}): Promise<SimulateResult & { ok: boolean; diagnostics: ApiDiagnostic[] }> {
    const r = await compileStory(path, this.host.readFile);
    const diagnostics = plainDiagnostics(r.diagnostics);
    if (!r.story) return { ok: false, diagnostics, runs: 0, endings: [], truncated: 0, stuck: 0, errors: [], steps: { min: 0, mean: 0, max: 0 } };
    const game = options.game ?? (await this.host.gameConfigFor(path)) ?? undefined;
    return { ok: true, diagnostics, ...simulateStory(r.story, { ...options, game }) };
  }

  async compile(path: string): Promise<CompileReport> {
    const r = await compileStory(path, this.host.readFile);
    return { ok: r.ok, diagnostics: plainDiagnostics(r.diagnostics), flows: r.flows, files: r.files };
  }

  async graph(path: string): Promise<GraphReport> {
    const r = await compileStory(path, this.host.readFile);
    const nodes = r.graph?.nodes ?? [];
    return {
      ok: r.ok,
      diagnostics: plainDiagnostics(r.diagnostics),
      nodes,
      edges: r.graph?.edges ?? [],
      unreachable: nodes.filter((n) => !n.reachable && n.kind !== "end").map((n) => n.id),
    };
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
      chosen: s.chosen,
      pinned: s.pinned,
      replay: s.replay ?? null,
      stopped: s.stopped ?? null,
      text: s.log.map((p) => p.text),
      choices: s.choices,
      ended: s.ended,
      errors: s.runtimeErrors,
      diagnostics: plainDiagnostics(s.diagnostics),
      flows: s.flows,
      language: s.storyLanguage,
      game: s.game ? { character: s.game.current, checks: s.game.checks, needs: s.game.needs, plays: s.game.plays, hud: s.game.hud, map: s.game.map, dungeon: s.game.dungeon, rolls: s.game.rolls } : null,
      ...insp,
    };
  }

  choose(choice: number | string, value?: string): PanelReport {
    const target = pick(this.host.snapshot().choices, choice);
    if (!target) {
      const report = this.panel();
      return { ...report, errors: [...report.errors, T().choiceNotFound(String(choice), report.choices.map((c) => c.text))] };
    }
    // An #input choice cannot be taken without a line typed, as in the panel.
    const variable = inputOf(target);
    if (variable !== null && (value ?? "").trim() === "") {
      const report = this.panel();
      return { ...report, errors: [...report.errors, T().inputNeeded(target.text)] };
    }
    this.host.choose(target.index, value);
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

  back(): PanelReport {
    this.host.back();
    return this.panel();
  }

  language(lang: string): PanelReport {
    this.host.setStoryLanguage(lang);
    return this.panel();
  }

  character(id: string): PanelReport {
    this.host.selectCharacter(id);
    return this.panel();
  }

  async save(name?: string): Promise<{ id: string; name: string; savedAt: string } | null> {
    const slot = await this.host.saveGame(name);
    return slot && { id: slot.id, name: slot.name, savedAt: slot.savedAt };
  }

  run(): unknown {
    return this.host.currentRun();
  }

  exportRun(): Promise<{ path: string | null }> {
    return this.host.exportRun();
  }

  importRun(path: string): Promise<{ id: string; name: string } | null> {
    return this.host.importRun(path);
  }

  async runs(): Promise<{ id: string; name: string; draft: boolean; updatedAt: string; actions: number; conflictOf?: string }[]> {
    return (await this.host.runsForRoot()).map((r) => ({ id: r.id, name: r.name, draft: r.draft, updatedAt: r.updatedAt, actions: r.actions.length, ...(r.conflictOf ? { conflictOf: r.conflictOf } : {}) }));
  }

  saves(): { id: string; name: string; savedAt: string }[] {
    return this.host.savesForRoot().map(({ id, name, savedAt }) => ({ id, name, savedAt }));
  }

  load(idOrName: string): PanelReport {
    const slot = this.findSave(idOrName);
    if (!slot) return this.withError(T().saveNotFound(idOrName));
    this.host.loadGame(slot.id);
    return this.panel();
  }

  async deleteSave(idOrName: string): Promise<{ id: string; name: string; savedAt: string }[]> {
    const slot = this.findSave(idOrName);
    if (slot) await this.host.deleteSave(slot.id);
    return this.saves();
  }

  private findSave(idOrName: string) {
    const all = this.host.savesForRoot();
    return all.find((s) => s.id === idOrName) ?? all.find((s) => s.name === idOrName);
  }

  private withError(message: string): PanelReport {
    const report = this.panel();
    return { ...report, errors: [...report.errors, message] };
  }
}
