import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Flow } from "../compile/compile";
import type { Diagnostic } from "../compile/diagnostics";
import { T, getLanguage } from "../i18n";
import type { Inspection } from "../play/inspect";
import { STORY_LANGUAGES, type Choice, type Paragraph } from "../play/session";
import type { ChoiceCheck, HudView, RollRecord } from "../game/engine";

/** What the game mode adds to the panel; null when the story is a plain story. */
export interface GameView {
  characters: { id: string; name: string }[];
  current: string | null;
  skills: { id: string; name: string; color?: string }[];
  hud: HudView;
  /** Check info per choice, aligned with `choices`; null for plain choices. */
  checks: (ChoiceCheck | null)[];
  /** Speaking skill per paragraph, aligned with `log`. */
  voices: (string | null)[];
  rolls: RollRecord[];
}

export const PLAY_VIEW_TYPE = "inkwright-play";

export interface PlayState {
  root: string | null;
  locked: string | null;
  diagnostics: Diagnostic[];
  hasStory: boolean;
  log: Paragraph[];
  choices: Choice[];
  ended: boolean;
  runtimeErrors: string[];
  inspection: Inspection | null;
  flows: Flow[];
  startPoint: string | null;
  canGoBack: boolean;
  /** Current language of a bilingual story; null when the story is not bilingual. */
  storyLanguage: string | null;
  saves: { id: string; name: string; savedAt: string }[];
  game: GameView | null;
}

export interface PlayController {
  restart(): void;
  back(): void;
  saveGame(): Promise<unknown>;
  loadGame(id: string): void;
  deleteSave(id: string): Promise<void>;
  startAt(path: string | null): void;
  choose(index: number): void;
  setStoryLanguage(lang: string): void;
  selectCharacter(id: string): void;
  toggleLock(): void;
  openDiagnostic(d: Diagnostic): Promise<void>;
}

export class PlayView extends ItemView {
  private state: PlayState | null = null;
  private inspectorOpen = false;
  private savesOpen = false;
  private diceOpen = false;

  constructor(leaf: WorkspaceLeaf, private readonly controller: PlayController) {
    super(leaf);
  }

  getViewType(): string {
    return PLAY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return T().playName;
  }

  getIcon(): string {
    return "play";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("inkwright-play");
    this.render();
  }

  showState(state: PlayState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    const s = this.state;
    if (!s || s.root === null) {
      el.createEl("p", { text: T().noRoot, cls: "inkwright-hint" });
      return;
    }

    const bar = el.createDiv({ cls: "inkwright-bar" });
    const locked = s.locked !== null;
    bar.createSpan({
      cls: "inkwright-root",
      text: T().rootLine(s.root, locked),
    });
    bar.createEl("button", { text: T().restart }).onclick = () => this.controller.restart();
    bar.createEl("button", { text: locked ? T().unlockShort : T().lock }).onclick = () =>
      this.controller.toggleLock();
    if (s.hasStory) {
      const back = bar.createEl("button", { text: T().back });
      back.disabled = !s.canGoBack;
      back.onclick = () => this.controller.back();
      bar.createEl("button", { text: T().save }).onclick = () => void this.controller.saveGame();
    }
    if (s.hasStory && s.game && s.game.characters.length > 1) {
      const select = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": T().character, title: T().character } });
      for (const c of s.game.characters) select.createEl("option", { text: c.name, value: c.id });
      select.value = s.game.current ?? s.game.characters[0].id;
      select.onchange = () => this.controller.selectCharacter(select.value);
    }
    if (s.hasStory && s.storyLanguage !== null) {
      const select = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": T().storyLanguage, title: T().storyLanguage } });
      for (const { code, name } of STORY_LANGUAGES) {
        select.createEl("option", { text: name, value: code });
      }
      select.value = s.storyLanguage;
      select.onchange = () => this.controller.setStoryLanguage(select.value);
    }

    if (s.flows.length > 0) this.renderStartFrom(el, s);
    if (s.hasStory && s.game) this.renderHud(el, s.game);
    if (s.inspection) this.renderInspector(el, s.inspection);
    if (s.hasStory && s.game) this.renderDice(el, s.game);
    if (s.hasStory && s.saves.length > 0) this.renderSaves(el, s);

    if (s.diagnostics.length > 0) {
      const box = el.createDiv({ cls: "inkwright-diagnostics" });
      box.createEl("h4", { text: T().errors });
      for (const d of s.diagnostics) {
        const row = box.createDiv({ cls: `inkwright-diag inkwright-diag-${d.severity}` });
        const where = d.line !== null ? ` ${T().lineAt(d.line)}` : "";
        row.createSpan({ cls: "inkwright-diag-loc", text: `${d.file}${where}` });
        row.createDiv({ text: d.message });
        row.onclick = () => void this.controller.openDiagnostic(d);
      }
    }

    if (!s.hasStory) return;

    const story = el.createDiv({ cls: "inkwright-story" });
    s.log.forEach((p, i) => {
      const voice = s.game?.voices[i] ?? null;
      const skill = voice ? s.game?.skills.find((k) => k.id === voice) : undefined;
      const para = story.createEl("p");
      if (skill) {
        para.addClass("inkwright-voice");
        if (skill.color) para.setCssProps({ "--inkwright-voice": skill.color });
        para.createSpan({ cls: "inkwright-voice-name", text: skill.name });
      }
      para.appendText(p.text);
    });
    for (const msg of s.runtimeErrors) story.createDiv({ cls: "inkwright-diag inkwright-diag-error", text: msg });
    if (s.ended) story.createEl("p", { text: T().ended, cls: "inkwright-ended" });

    const choices = el.createDiv({ cls: "inkwright-choices" });
    s.choices.forEach((c, i) => {
      const button = choices.createEl("button", { text: c.text, cls: "inkwright-choice" });
      const check = s.game?.checks[i] ?? null;
      if (check) this.renderCheck(button, check, s.game);
      button.onclick = () => this.controller.choose(c.index);
    });
    // Keep the newest text and choices in view, especially on small screens.
    choices.scrollIntoView({ block: "end" });
  }

  /** The skill, difficulty and odds of a check choice, on the button. */
  private renderCheck(button: HTMLElement, check: ChoiceCheck, game: GameView | null): void {
    const name = game?.skills.find((k) => k.id === check.skill)?.name ?? check.skill;
    const pct = Math.round(check.chance.success * 100);
    const badge = button.createSpan({ cls: "inkwright-check", text: `${name} ${check.difficulty} · ${pct}%` });
    if (check.red) badge.createSpan({ cls: "inkwright-check-red", text: ` · ${T().redCheck}` });
    const parts = [`${name} ${check.level}`, ...check.modifiers.map((m) => `${m.value > 0 ? "+" : ""}${m.value} ${m.source}`)];
    button.title = parts.join(", ");
  }

  private renderHud(el: HTMLElement, game: GameView): void {
    const hud = el.createDiv({ cls: "inkwright-hud" });
    for (const r of game.hud.resources) {
      const row = hud.createDiv({ cls: "inkwright-hud-row" });
      row.createSpan({ cls: "inkwright-hud-name", text: r.name });
      const bar = row.createDiv({ cls: "inkwright-hud-bar" });
      const span = Math.max(1, r.max - r.min);
      bar.createDiv({ cls: "inkwright-hud-fill" }).setCssProps({ width: `${Math.round(((r.value - r.min) / span) * 100)}%` });
      row.createSpan({ cls: "inkwright-hud-value", text: `${r.value}/${r.max}` });
    }
    for (const c of game.hud.companions) {
      const text = [c.name, ...c.resources.map((r) => `${r.name} ${r.value}`)].join(" · ");
      hud.createDiv({ cls: "inkwright-hud-companion", text });
    }
  }

  private renderDice(el: HTMLElement, game: GameView): void {
    const box = el.createEl("details", { cls: "inkwright-inspector inkwright-dice" });
    box.open = this.diceOpen;
    box.addEventListener("toggle", () => {
      this.diceOpen = box.open;
    });
    box.createEl("summary", { text: `${T().diceLog}(${game.rolls.length})` });
    if (game.rolls.length === 0) {
      box.createDiv({ cls: "inkwright-inspector-empty", text: T().noRolls });
      return;
    }
    const t = box.createEl("table");
    for (const r of [...game.rolls].reverse()) {
      const name = r.unknown ? `${r.skill} ${T().unknownSkill}` : game.skills.find((k) => k.id === r.skill)?.name ?? r.skill;
      const dice = r.rolls.length > 0 ? r.rolls.join("+") : "—";
      const mods = r.modifiers.map((m) => ` ${m.value > 0 ? "+" : ""}${m.value}`).join("");
      const tr = t.createEl("tr");
      tr.createEl("td", { text: `${name} ${r.difficulty}` });
      tr.createEl("td", { text: `${dice} +${r.level}${mods} = ${r.total} · ${T().bands[r.band]} (${Math.round(r.chance.success * 100)}%)` });
    }
  }

  private renderInspector(el: HTMLElement, insp: Inspection): void {
    const box = el.createEl("details", { cls: "inkwright-inspector" });
    box.open = this.inspectorOpen;
    box.addEventListener("toggle", () => {
      this.inspectorOpen = box.open;
    });
    box.createEl("summary", { text: `${T().inspector} · ${T().turns(insp.turns)}` });
    const table = (title: string, rows: [string, string][]) => {
      box.createEl("h5", { text: title });
      if (rows.length === 0) {
        box.createDiv({ cls: "inkwright-inspector-empty", text: T().none });
        return;
      }
      const t = box.createEl("table");
      for (const [k, v] of rows) {
        const tr = t.createEl("tr");
        tr.createEl("td", { text: k });
        tr.createEl("td", { text: v });
      }
    };
    table(T().variables, insp.variables.map((v) => [v.name, v.value]));
    table(T().visits, insp.visits.map((v) => [v.path, String(v.count)]));
  }

  private renderStartFrom(el: HTMLElement, s: PlayState): void {
    const row = el.createDiv({ cls: "inkwright-start" });
    row.createSpan({ text: T().startFrom });
    const select = row.createEl("select", { cls: "dropdown" });
    select.createEl("option", { value: "", text: T().beginning });
    for (const f of s.flows) {
      const label = f.kind === "stitch" ? `\u00a0\u00a0${f.path}` : f.path;
      select.createEl("option", { value: f.path, text: label });
    }
    select.value = s.startPoint ?? "";
    select.onchange = () => this.controller.startAt(select.value === "" ? null : select.value);
    if (s.startPoint !== null) el.createDiv({ cls: "inkwright-hint-small", text: T().startedMidway });
  }

  private renderSaves(el: HTMLElement, s: PlayState): void {
    const box = el.createEl("details", { cls: "inkwright-inspector inkwright-saves" });
    box.open = this.savesOpen;
    box.addEventListener("toggle", () => {
      this.savesOpen = box.open;
    });
    box.createEl("summary", { text: `${T().saves}(${s.saves.length})` });
    for (const slot of s.saves) {
      const row = box.createDiv({ cls: "inkwright-save-row" });
      const info = row.createDiv({ cls: "inkwright-save-info" });
      info.createDiv({ text: slot.name });
      info.createDiv({ cls: "inkwright-save-time", text: new Date(slot.savedAt).toLocaleString(getLanguage() === "zh" ? "zh-CN" : "en") });
      row.createEl("button", { text: T().load }).onclick = () => this.controller.loadGame(slot.id);
      row.createEl("button", { text: T().delete }).onclick = () => void this.controller.deleteSave(slot.id);
    }
  }
}
