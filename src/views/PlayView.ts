import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Flow } from "../compile/compile";
import type { Diagnostic } from "../compile/diagnostics";
import { T, getLanguage } from "../i18n";
import type { Inspection } from "../play/inspect";
import { STORY_LANGUAGES, type Choice, type Paragraph } from "../play/session";
import type { ChoiceCheck, ChoiceNeed, HudView, RollRecord } from "../game/engine";
import { fxOf, type Fx } from "../game/config";

/** What the game mode adds to the panel; null when the story is a plain story. */
export interface GameView {
  characters: { id: string; name: string }[];
  current: string | null;
  skills: { id: string; name: string; color?: string; stance?: string }[];
  hud: HudView;
  /** Check info per choice, aligned with `choices`; null for plain choices. */
  checks: (ChoiceCheck | null)[];
  /** Items each choice needs, aligned with `choices`; a missing one locks the choice. */
  needs: ChoiceNeed[][];
  /** Speaking skill per paragraph, aligned with `log`. */
  voices: (string | null)[];
  /** The story's turn per paragraph, aligned with `log`; rolls are placed by it. */
  turns: (number | null)[];
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
  /** Story and paragraph count last rendered, to scroll new text into view. */
  private shownRoot: string | null = null;
  private shownLog = 0;
  /** Set when a choice button was clicked, so the next text that arrives is scrolled to. */
  private afterChoice = false;

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
    // Text shown for the first time after a choice clicked here is scrolled to, its dice tumble
    // and its effects play. When the text changed for another reason (back, restart, a save
    // loaded, the panel opened on a run, another story), the choices are shown instead; a
    // re-render with the same text (config reload, HUD update) leaves the scroll position alone.
    const sameRun = s.root === this.shownRoot;
    const grew = sameRun && s.log.length > this.shownLog;
    const changed = !sameRun || s.log.length !== this.shownLog;
    const from = this.shownLog;
    const fresh = grew && this.afterChoice;
    this.shownRoot = s.root;
    this.shownLog = s.log.length;
    this.afterChoice = false; // a choice renders exactly once (the step is synchronous)

    // A roll shows as a card where its check happened: before the first paragraph of its turn.
    const rollsByTurn = new Map<number, RollRecord[]>();
    for (const r of s.game?.rolls ?? []) rollsByTurn.set(r.turn, [...(rollsByTurn.get(r.turn) ?? []), r]);
    const paras: HTMLElement[] = [];
    const newCards: HTMLElement[] = [];
    let lastTurn: number | null = null;
    s.log.forEach((p, i) => {
      const turn = s.game?.turns[i] ?? null;
      if (s.game && turn !== null && (i === 0 || turn !== lastTurn)) {
        for (const r of rollsByTurn.get(turn) ?? []) {
          const card = this.renderRoll(story, r, s.game);
          if (fresh && i >= from) newCards.push(card);
        }
      }
      lastTurn = turn;
      const voice = s.game?.voices[i] ?? null;
      const skill = voice ? s.game?.skills.find((k) => k.id === voice) : undefined;
      const para = story.createEl("p");
      paras.push(para);
      if (skill) {
        para.addClass("inkwright-voice");
        if (skill.color) para.setCssProps({ "--inkwright-voice": skill.color });
        para.createSpan({ cls: "inkwright-voice-name", text: skill.name, ...(skill.stance ? { title: skill.stance } : {}) });
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
      const needs = s.game?.needs[i] ?? [];
      for (const need of needs) {
        button.createSpan({ cls: `inkwright-need${need.has ? "" : " inkwright-need-missing"}`, text: `${T().needs} ${need.name}` });
      }
      if (needs.some((n) => !n.has)) {
        button.disabled = true;
        button.addClass("inkwright-choice-locked");
      }
      button.onclick = () => {
        this.afterChoice = true;
        this.controller.choose(c.index);
      };
    });
    if (fresh) {
      (newCards[0] ?? paras[from]).scrollIntoView({ block: "start" });
      this.animateRolls(newCards);
      this.playFx(story, s.log.slice(from).flatMap((p) => fxOf(p.tags)));
    } else if (changed) {
      choices.scrollIntoView({ block: "end" });
    }
  }

  /** One resolved check as a card in the text: skill and difficulty, the faces, the sum, the outcome. */
  private renderRoll(parent: HTMLElement, r: RollRecord, game: GameView): HTMLElement {
    const card = parent.createDiv({ cls: `inkwright-roll inkwright-roll-${r.band}` });
    const name = r.unknown ? `${r.skill} ${T().unknownSkill}` : game.skills.find((k) => k.id === r.skill)?.name ?? r.skill;
    card.createSpan({ cls: "inkwright-roll-skill", text: `${name} ${r.difficulty}` });
    const dice = card.createSpan({ cls: "inkwright-roll-dice" });
    for (const face of r.rolls) dice.createSpan({ cls: "inkwright-die", text: String(face) });
    const mods = r.modifiers.map((m) => ` ${m.value > 0 ? "+" : ""}${m.value}`).join("");
    card.createSpan({ cls: "inkwright-roll-sum", text: `+${r.level}${mods} = ${r.total}` });
    card.createSpan({ cls: "inkwright-roll-band", text: T().bands[r.band] });
    return card;
  }

  private static get stillMotion(): boolean {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** The faces of new cards tumble for a moment before settling; the outcome shows once they have. */
  private animateRolls(cards: HTMLElement[]): void {
    if (cards.length === 0 || PlayView.stillMotion) return;
    for (const card of cards) {
      const dice = Array.from(card.querySelectorAll<HTMLElement>(".inkwright-die"));
      const faces = dice.map((d) => d.textContent ?? "");
      card.addClass("inkwright-rolling");
      let ticks = 0;
      const timer = window.setInterval(() => {
        if (++ticks > 8) {
          window.clearInterval(timer);
          dice.forEach((d, i) => d.setText(faces[i]));
          card.removeClass("inkwright-rolling");
          return;
        }
        for (const d of dice) d.setText(String(1 + Math.floor(Math.random() * 6)));
      }, 70);
      this.registerInterval(timer);
    }
  }

  /** Plays the effects of the new lines on the story, one after another. */
  private playFx(target: HTMLElement, effects: Fx[]): void {
    if (effects.length === 0 || PlayView.stillMotion) return;
    effects.forEach((fx, i) => {
      const play = () => {
        const cls = `inkwright-fx-${fx}`;
        const done = () => target.removeClass(cls);
        target.addClass(cls);
        target.addEventListener("animationend", done, { once: true });
        window.setTimeout(done, 2500);
      };
      if (i === 0) play();
      else window.setTimeout(play, i * 900);
    });
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
    if (game.hud.items) {
      const row = hud.createDiv({ cls: "inkwright-hud-row inkwright-hud-items" });
      row.createSpan({ cls: "inkwright-hud-name", text: T().inventory });
      if (game.hud.items.length === 0) row.createSpan({ cls: "inkwright-hud-value", text: T().nothingCarried });
      for (const item of game.hud.items) row.createSpan({ cls: "inkwright-item", text: item.name, ...(item.desc ? { title: item.desc } : {}) });
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
