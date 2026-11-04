import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { Flow } from "../compile/compile";
import type { Diagnostic } from "../compile/diagnostics";
import { T, getLanguage } from "../i18n";
import type { Inspection } from "../play/inspect";
import { inputOf, isWrite } from "../play/input";
import { STORY_LANGUAGES, type Choice, type Paragraph, type PlacedAside } from "../play/session";
import { ODDS, type Odds, type OracleResult, type TrayRoll } from "../play/oracle";
import { mergeAsides } from "../play/journal";
import type { ChoiceCheck, ChoiceNeed, ChoicePlay, HandView, HudView, GridView, MapView, RollRecord } from "../game/engine";
import { fxOf, type Fx } from "../game/config";
import { tokenText } from "../game/dice";

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
  /** The hand each choice plays a card from (`#play`), aligned with `choices`; null for other choices. */
  plays: (ChoicePlay | null)[];
  /** The map with the state read into it; null when the game has none. `mapImage` is its image as a URL the panel can show. */
  map: MapView | null;
  mapImage: string | null;
  /** The growing dungeon drawn so far; null when the game has none or nothing is drawn. */
  dungeon: GridView | null;
  /** Card art by card id, as URLs the panel can show. */
  cardImages: Record<string, string>;
  /** Speaking skill per paragraph, aligned with `log`. */
  voices: (string | null)[];
  /** The story's turn per paragraph, aligned with `log`; rolls are placed by it. */
  turns: (number | null)[];
  rolls: RollRecord[];
}

export const PLAY_VIEW_TYPE = "inkwright-play";

/** The status column (party, resources, map, dice) folded away to give the text room; kept when the player moves between the sidebar and the main area. */
let sideHidden = false;

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
  /** The latest choice made in this run: its text and the index of the first paragraph it produced. */
  chosen: { text: string; at: number } | null;
  /** Whether the top bar stays put while the text scrolls. */
  pinned: boolean;
  /** A saved run being replayed (the panel takes no input meanwhile); null when none is. */
  replay?: { done: number; total: number } | null;
  /** Why the panel stopped short of where the run had got to; null when it did not. */
  stopped?: { reason: "mismatch" | "error" | "budget" | "start" | "character" | "chosen"; step: number; pending: number; detail?: string; older?: boolean } | null;
  /** What the replay noticed without stopping: steps found by a guess, the first step (1-based) whose outcome changed. */
  note?: { guesses: number; drift: number | null } | null;
  /** Playing an older version of the story (from before an edit); null when playing the newest. */
  frozen?: { at: string } | null;
  /** Player mode: the author's controls are out of the way, and edits to the story wait until applied. */
  playerMode?: boolean;
  /** Player mode: the story was edited; the run plays on the version it was on until the update is applied. */
  update?: boolean;
  /** The run was picked up after a while: where the player left off, and when. */
  recap?: { at: number; when: string } | null;
  /** The dice tray's questions and rolls, where they were asked. */
  asides?: PlacedAside[];
  /** Tables offered on the tray (marked `oracle: true` in the game note). */
  trayTables?: { id: string; name: string }[];
}

export interface PlayController {
  restart(): void;
  back(): void;
  saveGame(): Promise<unknown>;
  loadGame(id: string): void;
  deleteSave(id: string): Promise<void>;
  startAt(path: string | null): void;
  /** Takes a choice; a `#play` choice is taken with the id of a card picked from its hand, an `#input` choice with the text typed. */
  choose(index: number, value?: string): void;
  setStoryLanguage(lang: string): void;
  selectCharacter(id: string): void;
  toggleLock(): void;
  togglePin(): void;
  /** Moves the player between the right sidebar and the main area. */
  movePlay(view: PlayView): void;
  inMainArea(view: PlayView): boolean;
  openDiagnostic(d: Diagnostic): Promise<void>;
  /** Hides the note that the run stopped short. */
  dismissStop(): void;
  /** Takes the steps a replay could not take by their index. */
  continueByIndex(): void;
  /** Plays the run on the version of the story it was last played on. */
  useOlder(): void;
  /** Goes back to the newest version of the story. */
  useNewest(): void;
  /** Stops the run at the step whose outcome changed. */
  stopAtDrift(): void;
  dismissNote(): void;
  togglePlayerMode(): void;
  /** The dice tray: a yes/no question to the oracle, a formula, a table. */
  askOracle(question: string, odds: Odds): void;
  rollTray(formula: string, table?: string): void;
  /** Changes a resource marked `manual` by hand. */
  adjustResource(id: string, delta: number, value?: number): void;
  /** Adds an entry to a record, or takes one out, by hand. */
  changeRecord(id: string, op: "add" | "remove", entry: string): void;
}

/** Paragraphs drawn at most; earlier ones wait behind a button, so a long run stays quick to draw. */
const SHOWN_PARAGRAPHS = 200;

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
  /** The card tapped in a hand, for the next `#play` choice; forgotten when the choices change. */
  private picked: { hand: string; card: string } | null = null;
  private pickedAt = "";
  /** The story whose earlier paragraphs the player asked to see; they are hidden again for another story. */
  private showAllFor: string | null = null;
  /** Player mode: the problems the story has, shown when its badge is clicked. */
  private problemsOpen = false;
  /** A record an entry was just added to: its add box is focused again after the redraw. */
  private focusRecord: string | null = null;
  /** The dice tray is unfolded; what was typed in it is kept across redraws. */
  private trayOpen = false;
  private trayQuestion = "";
  private trayOdds: Odds = "even";
  private trayFormula = "";
  /** Tray cards drawn last time (per story), so a new one is scrolled into view. */
  private shownAsides = 0;
  private asidesRoot: string | null = null;
  /** Text typed into `#input` choices, by choice index; kept across re-renders of the same spot, like `picked`. */
  private typed = new Map<number, string>();
  private bar: HTMLElement | null = null;

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
    const watch = new ResizeObserver(() => this.fitSide());
    watch.observe(this.contentEl);
    this.register(() => watch.disconnect());
    this.render();
  }

  /** The sticky status column starts under a pinned bar and is as tall as the panel leaves it (its own scroll beyond that). */
  private fitSide(): void {
    const el = this.contentEl;
    const pinned = this.bar?.hasClass("inkwright-bar-pinned") ?? false;
    const top = pinned && this.bar ? this.bar.offsetHeight : 0;
    el.setCssProps({ "--inkwright-side-top": `${top}px`, "--inkwright-side-max": `${Math.max(200, el.clientHeight - top - 24)}px` });
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

    const bar = el.createDiv({ cls: `inkwright-bar${s.pinned ? " inkwright-bar-pinned" : ""}` });
    this.bar = bar;
    const locked = s.locked !== null;
    bar.createSpan({
      cls: "inkwright-root",
      text: T().rootLine(s.root, locked),
    });
    const player = s.playerMode ?? false;
    bar.createEl("button", { text: T().restart }).onclick = () => this.controller.restart();
    if (!player) {
      bar.createEl("button", { text: locked ? T().unlockShort : T().lock }).onclick = () =>
        this.controller.toggleLock();
    }
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
    const mode = bar.createEl("button", { cls: `inkwright-mode${player ? " inkwright-mode-on" : ""}`, attr: { "aria-label": player ? T().authorMode : T().playerMode, title: player ? T().authorMode : T().playerMode } });
    setIcon(mode, player ? "pencil" : "gamepad-2");
    mode.onclick = () => this.controller.togglePlayerMode();
    const pin = bar.createEl("button", { cls: `inkwright-pin${s.pinned ? " inkwright-pin-on" : ""}`, attr: { "aria-label": s.pinned ? T().unpin : T().pin, title: s.pinned ? T().unpin : T().pin } });
    setIcon(pin, "pin");
    pin.onclick = () => this.controller.togglePin();
    const inMain = this.controller.inMainArea(this);
    const move = bar.createEl("button", { cls: "inkwright-move", attr: { "aria-label": inMain ? T().toSide : T().toMain, title: inMain ? T().toSide : T().toMain } });
    setIcon(move, inMain ? "minimize-2" : "maximize-2");
    move.onclick = () => this.controller.movePlay(this);

    // The status (party, resources, map, dice) goes in its own column when the panel is wide enough
    // (styles.css, a container query); narrow, it sits above the text and can be folded away.
    const hasSide = s.hasStory && s.game !== null && s.game !== undefined;
    if (hasSide) {
      const fold = bar.createEl("button", { cls: `inkwright-fold${sideHidden ? "" : " inkwright-fold-on"}`, attr: { "aria-label": sideHidden ? T().showSide : T().hideSide, title: sideHidden ? T().showSide : T().hideSide } });
      setIcon(fold, "layout-dashboard");
      fold.onclick = () => {
        sideHidden = !sideHidden;
        this.render();
      };
    }
    const stage = el.createDiv({ cls: `inkwright-stage${hasSide && !sideHidden ? " inkwright-stage-split" : ""}` });
    const side = stage.createDiv({ cls: `inkwright-side${hasSide && !sideHidden ? "" : " inkwright-side-hidden"}` });
    const main = stage.createDiv({ cls: "inkwright-main" });
    this.fitSide();

    if (s.flows.length > 0 && !player) this.renderStartFrom(main, s);
    if (s.hasStory && s.game) this.renderHud(side, s.game);
    if (s.hasStory && s.game?.map) this.renderMap(side, s.game.map, s.game.mapImage);
    if (s.hasStory && s.game?.dungeon) this.renderDungeon(side, s.game.dungeon);
    if (s.inspection && !player) this.renderInspector(main, s.inspection);
    if (s.hasStory && s.game) this.renderDice(side, s.game);
    if (s.hasStory && s.saves.length > 0) this.renderSaves(main, s);

    // Player mode: the story's problems are one small badge until asked for.
    if (player && s.diagnostics.length > 0) {
      const badge = main.createEl("button", { cls: "inkwright-problems", text: T().problems(s.diagnostics.length) });
      badge.onclick = () => {
        this.problemsOpen = !this.problemsOpen;
        this.render();
      };
    }
    if (s.update) {
      const note = main.createDiv({ cls: "inkwright-run-note inkwright-frozen" });
      note.createSpan({ text: T().storyUpdated });
      note.createDiv({ cls: "inkwright-run-note-buttons" }).createEl("button", { text: T().applyUpdate }).onclick = () => this.controller.useNewest();
    }
    if (s.diagnostics.length > 0 && (!player || this.problemsOpen)) {
      const box = main.createDiv({ cls: "inkwright-diagnostics" });
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

    const story = main.createDiv({ cls: "inkwright-story" });
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
    // The latest choice draws a line with its text where the text it produced begins.
    let line: HTMLElement | null = null;
    const turnLine = () => {
      line = story.createDiv({ cls: "inkwright-turn" });
      line.createSpan({ cls: "inkwright-turn-text", text: s.chosen?.text ?? "" });
    };
    // A long run draws its latest paragraphs; the earlier ones are behind a button.
    const first = this.showAllFor === s.root ? 0 : Math.max(0, s.log.length - SHOWN_PARAGRAPHS);
    if (first > 0) {
      story.createEl("button", { cls: "inkwright-earlier", text: T().showEarlier(first) }).onclick = () => {
        this.showAllFor = s.root;
        this.render();
      };
      lastTurn = s.game?.turns[first - 1] ?? null;
    }
    // The tray's questions and rolls, drawn where they were asked: before the paragraph that came after them.
    const asides = mergeAsides(s.asides ?? []);
    let nextAside = 0;
    const asidesBefore = (i: number) => {
      while (nextAside < asides.length && asides[nextAside].at <= i) {
        const a = asides[nextAside++];
        if (a.at >= first) newCards.push(this.renderAside(story, a));
      }
    };
    s.log.forEach((p, i) => {
      if (i < first) return;
      asidesBefore(i);
      if (s.chosen && s.chosen.at === i) turnLine();
      const turn = s.game?.turns[i] ?? null;
      if (s.game && turn !== null && (i === first || turn !== lastTurn)) {
        for (const r of rollsByTurn.get(turn) ?? []) {
          const card = this.renderRoll(story, r, s.game);
          if (fresh && i >= from) newCards.push(card);
        }
      }
      lastTurn = turn;
      const voice = s.game?.voices[i] ?? null;
      const skill = voice ? s.game?.skills.find((k) => k.id === voice) : undefined;
      const para = story.createEl("p");
      paras[i] = para;
      if (skill) {
        para.addClass("inkwright-voice");
        if (skill.color) para.setCssProps({ "--inkwright-voice": skill.color });
        para.createSpan({ cls: "inkwright-voice-name", text: skill.name, ...(skill.stance ? { title: skill.stance } : {}) });
      }
      para.appendText(p.text);
      // A paragraph the player wrote (#write) keeps its lines; other text is laid out as before.
      if (p.text.includes("\n")) para.addClass("inkwright-lines");
      // Picked up after a while: a line where the player left off.
      if (s.recap && s.recap.at === i + 1) story.createDiv({ cls: "inkwright-recap" }).createSpan({ cls: "inkwright-recap-text", text: T().leftOff(s.recap.when) });
    });
    asidesBefore(Number.MAX_SAFE_INTEGER);
    if (s.chosen && s.chosen.at >= s.log.length) turnLine();
    for (const msg of s.runtimeErrors) story.createDiv({ cls: "inkwright-diag inkwright-diag-error", text: msg });
    if (s.ended) story.createEl("p", { text: T().ended, cls: "inkwright-ended" });

    // A card picked in a hand belongs to this spot: the next text, or other choices, drop it.
    const spot = `${s.root ?? ""}\n${s.log.length}\n${s.choices.map((c) => c.text).join("\n")}`;
    if (spot !== this.pickedAt) {
      this.picked = null;
      this.typed.clear();
    }
    this.pickedAt = spot;
    // A #use choice on screen: what is carried shows as a row of cards to pick from, beside the hands.
    const using = (s.game?.plays ?? []).find((p) => p?.use && p.cards.length > 0);
    const hands = [...(s.game?.hud.hands ?? []), ...(using ? [{ id: using.hand, name: T().inventory, cards: using.cards }] : [])];
    if (s.game && hands.length > 0) this.renderHands(main, hands, s.game.cardImages);

    // Picking a saved run up: the text grows as it replays; there is nothing to choose until it is done.
    if (s.replay) {
      main.createDiv({ cls: "inkwright-run-note inkwright-replaying", text: T().replaying(s.replay.done, s.replay.total) });
      return;
    }
    if (s.frozen) this.renderFrozen(main, s.frozen.at);
    if (s.stopped) this.renderStopped(main, s.stopped);
    else if (s.note) this.renderNote(main, s.note);
    const choices = main.createDiv({ cls: "inkwright-choices" });
    s.choices.forEach((c, i) => {
      const play = s.game?.plays[i] ?? null;
      const card = play && this.picked?.hand === play.hand ? play.cards.find((k) => k.id === this.picked?.card) : undefined;
      // An #input choice (not a #play one) gets a text field above its button; the button waits for a line.
      const variable = play ? null : inputOf(c);
      // #write asks for a paragraph: a box of several lines (Enter is a new line; Ctrl/Cmd+Enter takes the choice).
      const multiline = variable !== null && isWrite(c);
      const field: HTMLInputElement | HTMLTextAreaElement | null = variable === null ? null
        : multiline ? choices.createEl("textarea", { cls: "inkwright-input inkwright-write", placeholder: T().writeHere, text: this.typed.get(c.index) ?? "" })
        : choices.createEl("input", { cls: "inkwright-input", type: "text", placeholder: T().typeHere, value: this.typed.get(c.index) ?? "" });
      const button = choices.createEl("button", { text: card ? `${c.text} · ${card.name}` : c.text, cls: "inkwright-choice" });
      const check = s.game?.checks[i] ?? null;
      if (check) this.renderCheck(button, check, s.game);
      const needs = s.game?.needs[i] ?? [];
      for (const need of needs) {
        button.createSpan({ cls: `inkwright-need${need.has ? "" : " inkwright-need-missing"}`, text: `${T().needs} ${need.name}` });
      }
      // A #play choice waits for a card from its hand; with no card to play it is locked like a missing item.
      if (play && !card) button.createSpan({ cls: "inkwright-choice-pick", text: play.known && play.cards.length > 0 ? (play.use ? T().pickItem : T().pickCard) : `${play.use ? T().inventory : play.name} · ${T().nothingCarried}` });
      const locked = needs.some((n) => !n.has) || (play !== null && !card);
      if (locked) {
        button.disabled = true;
        button.addClass("inkwright-choice-locked");
      }
      button.onclick = () => {
        this.afterChoice = true;
        this.controller.choose(c.index, field ? field.value : card?.id);
      };
      if (field) {
        const empty = () => field.value.trim() === "";
        button.disabled = locked || empty();
        field.disabled = locked;
        field.oninput = () => {
          this.typed.set(c.index, field.value);
          button.disabled = locked || empty();
        };
        field.onkeydown = (e) => {
          // A line goes with Enter; a paragraph with Ctrl/Cmd+Enter (Enter alone is a new line in it).
          const go = e.key === "Enter" && !e.isComposing && (!multiline || e.ctrlKey || e.metaKey);
          if (go && !button.disabled) {
            e.preventDefault();
            button.click();
          }
        };
      }
    });
    if (s.hasStory) this.renderTray(main, s.trayTables ?? []);
    // A question just asked or a roll just made: its card is the last one; bring it into view.
    const asked = (s.asides ?? []).length;
    if (this.asidesRoot === s.root && asked > this.shownAsides) story.querySelectorAll(".inkwright-oracle, .inkwright-tray-roll").item(-1 + story.querySelectorAll(".inkwright-oracle, .inkwright-tray-roll").length)?.scrollIntoView({ block: "nearest" });
    this.asidesRoot = s.root;
    this.shownAsides = asked;
    if (fresh) {
      (line ?? newCards[0] ?? paras[from] ?? paras.find(Boolean))?.scrollIntoView({ block: "start" });
      this.animateRolls(newCards);
      this.playFx(story, s.log.slice(from).flatMap((p) => fxOf(p.tags)));
    } else if (changed) {
      choices.scrollIntoView({ block: "end" });
    }
  }

  /** One question or roll from the dice tray, as a card in the text. */
  private renderAside(parent: HTMLElement, a: PlacedAside): HTMLElement {
    const t = T();
    if (a.kind === "record") {
      const name = this.state?.game?.hud.records?.find((x) => x.id === a.var)?.name ?? a.var ?? "";
      return parent.createDiv({ cls: "inkwright-manual", text: `📝 ${name} ${a.op === "remove" ? "−" : "+"} ${a.entry ?? ""}` });
    }
    if (a.kind === "adjust" || a.kind === "set") {
      const r = a.result as { from: unknown; to: unknown } | null;
      const name = this.state?.game?.hud.resources.find((x) => x.id === a.var)?.name ?? a.var ?? "";
      const change = a.kind === "adjust" ? `${(a.delta ?? 0) > 0 ? "+" : ""}${a.delta ?? 0}` : `= ${String(a.value)}`;
      return parent.createDiv({ cls: "inkwright-manual", text: `✎ ${name} ${change}${r ? `(${String(r.from)} → ${String(r.to)})` : ""}` });
    }
    if (a.kind === "oracle") {
      const r = a.result as OracleResult;
      const answer = t.answers[r.answer === "yes" ? (r.extreme ? "yesAnd" : "yes") : r.extreme ? "noAnd" : "no"];
      const card = parent.createDiv({ cls: `inkwright-roll inkwright-oracle inkwright-oracle-${r.answer}` });
      card.createSpan({ cls: "inkwright-roll-skill", text: `🔮 ${a.question ?? ""}` });
      card.createSpan({ cls: "inkwright-oracle-odds", text: `${t.oddsNames[a.odds ?? "even"] ?? ""} · d100 ${r.roll} / ${r.threshold}` });
      card.createSpan({ cls: "inkwright-roll-band", text: answer });
      return card;
    }
    const r = a.result as TrayRoll;
    const card = parent.createDiv({ cls: "inkwright-roll inkwright-roll-free inkwright-tray-roll" });
    card.createSpan({ cls: "inkwright-roll-skill", text: r.table ? `${r.table.name} ${r.formula}` : r.formula });
    const dice = card.createSpan({ cls: "inkwright-roll-dice" });
    const out = new Set(r.dropped ?? []);
    r.rolls.forEach((face, i) => dice.createSpan({ cls: `inkwright-die${out.has(i) ? " inkwright-die-dropped" : ""}`, text: String(face) }));
    card.createSpan({ cls: "inkwright-roll-sum", text: `= ${r.total}` });
    if (r.table) card.createSpan({ cls: "inkwright-roll-band", text: r.table.text });
    return card;
  }

  /** The dice tray: ask the oracle, roll a formula or a common die, roll an inspiration table. Folded until opened. */
  private renderTray(el: HTMLElement, tables: { id: string; name: string }[]): void {
    const t = T();
    const tray = el.createEl("details", { cls: "inkwright-tray" });
    tray.open = this.trayOpen;
    tray.ontoggle = () => {
      this.trayOpen = tray.open;
    };
    tray.createEl("summary", { text: t.tray });
    const ask = tray.createDiv({ cls: "inkwright-tray-row" });
    const question = ask.createEl("input", { type: "text", placeholder: t.questionPlaceholder, value: this.trayQuestion, cls: "inkwright-tray-question" });
    question.oninput = () => {
      this.trayQuestion = question.value;
    };
    const odds = ask.createEl("select", { cls: "dropdown" });
    for (const o of ODDS) odds.createEl("option", { text: t.oddsNames[o], value: o });
    odds.value = this.trayOdds;
    odds.onchange = () => {
      this.trayOdds = odds.value as Odds;
    };
    const go = () => {
      this.trayQuestion = "";
      this.controller.askOracle(question.value, this.trayOdds);
    };
    ask.createEl("button", { text: t.ask, cls: "mod-cta" }).onclick = go;
    question.onkeydown = (e) => {
      if (e.key === "Enter" && !e.isComposing) go();
    };
    const roll = tray.createDiv({ cls: "inkwright-tray-row" });
    const formula = roll.createEl("input", { type: "text", placeholder: t.formulaPlaceholder, value: this.trayFormula, cls: "inkwright-tray-formula" });
    formula.oninput = () => {
      this.trayFormula = formula.value;
    };
    const rollIt = () => {
      if (formula.value.trim() !== "") this.controller.rollTray(formula.value.trim());
    };
    roll.createEl("button", { text: t.rollIt }).onclick = rollIt;
    formula.onkeydown = (e) => {
      if (e.key === "Enter" && !e.isComposing) rollIt();
    };
    for (const f of ["d6", "2d6", "d20", "d100"]) roll.createEl("button", { text: f, cls: "inkwright-tray-die" }).onclick = () => this.controller.rollTray(f);
    if (tables.length > 0) {
      const row = tray.createDiv({ cls: "inkwright-tray-row" });
      for (const tb of tables) row.createEl("button", { text: `🎲 ${tb.name}` }).onclick = () => this.controller.rollTray("", tb.id);
    }
  }

  /** Says where and why a saved run stopped short of where it had got to, and that the rest is kept. */
  private renderStopped(el: HTMLElement, st: NonNullable<PlayState["stopped"]>): void {
    const note = el.createDiv({ cls: "inkwright-run-note inkwright-stopped" });
    const t = T();
    const text =
      st.reason === "start" ? t.stoppedStart(st.detail ?? "")
      : st.reason === "character" ? t.stoppedCharacter(st.detail ?? "")
      : st.reason === "budget" ? t.stoppedBudget(st.step, st.pending)
      : st.reason === "error" ? t.stoppedError(st.step, st.pending)
      : st.reason === "chosen" ? t.stoppedHere(st.step, st.pending)
      : t.stoppedMismatch(st.step, st.pending);
    note.createSpan({ text });
    const buttons = note.createDiv({ cls: "inkwright-run-note-buttons" });
    if (st.pending > 0 && (st.reason === "mismatch" || st.reason === "chosen")) {
      buttons.createEl("button", { text: t.continueByIndex }).onclick = () => this.controller.continueByIndex();
    }
    if (st.older) buttons.createEl("button", { text: t.useOlder }).onclick = () => this.controller.useOlder();
    buttons.createEl("button", { text: t.dismiss }).onclick = () => this.controller.dismissStop();
  }

  /** A replay that went through but noticed something: choices found by a guess, an outcome that changed. */
  private renderNote(el: HTMLElement, n: NonNullable<PlayState["note"]>): void {
    const t = T();
    const note = el.createDiv({ cls: "inkwright-run-note inkwright-stopped" });
    const parts = [n.guesses > 0 ? t.guessed(n.guesses) : "", n.drift !== null ? t.drifted(n.drift) : ""].filter(Boolean);
    note.createSpan({ text: parts.join(" ") });
    const buttons = note.createDiv({ cls: "inkwright-run-note-buttons" });
    if (n.drift !== null) buttons.createEl("button", { text: t.stopAt(n.drift) }).onclick = () => this.controller.stopAtDrift();
    buttons.createEl("button", { text: t.dismiss }).onclick = () => this.controller.dismissNote();
  }

  /** Playing the version from before an edit: the edit is not used until the newest is applied. */
  private renderFrozen(el: HTMLElement, at: string): void {
    const t = T();
    const note = el.createDiv({ cls: "inkwright-run-note inkwright-frozen" });
    note.createSpan({ text: t.frozenNote(at) });
    note.createDiv({ cls: "inkwright-run-note-buttons" }).createEl("button", { text: t.useNewest }).onclick = () => this.controller.useNewest();
  }

  /** One roll as a card in the text: a check (skill and difficulty, faces, sum, outcome) or free dice (formula or table, faces, total, the row). */
  private renderRoll(parent: HTMLElement, r: RollRecord, game: GameView): HTMLElement {
    if (r.kind === "dice") {
      const card = parent.createDiv({ cls: "inkwright-roll inkwright-roll-free" });
      card.createSpan({ cls: "inkwright-roll-skill", text: r.deck ? r.deck.name : r.record ? r.record.name : r.table ? `${r.table.name} ${r.formula}` : r.formula });
      const dice = card.createSpan({ cls: "inkwright-roll-dice" });
      // Faces that do not count (not kept, or missed in a pool) are faded.
      const out = new Set(r.dropped ?? []);
      r.rolls.forEach((face, i) => dice.createSpan({ cls: `inkwright-die${out.has(i) ? " inkwright-die-dropped" : ""}`, text: String(face) }));
      card.createSpan({ cls: "inkwright-roll-sum", text: r.unknown ? T().badFormula : `= ${r.total}` });
      const result = r.deck ? r.deck.card : r.record ? r.record.entry : r.table?.text;
      if (result !== undefined) card.createSpan({ cls: "inkwright-roll-band", text: result, ...(r.deck?.desc ? { title: r.deck.desc } : {}) });
      return card;
    }
    const card = parent.createDiv({ cls: `inkwright-roll inkwright-roll-${r.band}` });
    const name = r.unknown ? `${r.skill} ${T().unknownSkill}` : game.skills.find((k) => k.id === r.skill)?.name ?? r.skill;
    card.createSpan({ cls: "inkwright-roll-skill", text: `${name} ${r.difficulty}` });
    const dice = card.createSpan({ cls: "inkwright-roll-dice" });
    // A chaos bag draws a token instead of rolling: shown as one chip, named or by its value.
    if (r.token) dice.createSpan({ cls: `inkwright-die inkwright-chip${r.token.auto ? ` inkwright-chip-${r.token.auto}` : ""}`, text: tokenText(r.token, { fail: T().autoFail, success: T().autoSuccess }) });
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
        // A bag's chip does not show dice faces while it "tumbles": a question mark instead.
        for (const d of dice) d.setText(d.hasClass("inkwright-chip") ? "?" : String(1 + Math.floor(Math.random() * 6)));
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

  /** The growing dungeon on its squares: floor per room (the room the party is in lit), walls, doors (free ones bright), a room's note in its middle. */
  private renderDungeon(el: HTMLElement, d: GridView): void {
    const S = 24;
    const { x, y, w, h } = d.box;
    const svg = el.createSvg("svg", { cls: "inkwright-dungeon", attr: { viewBox: `0 0 ${w * S} ${h * S}`, preserveAspectRatio: "xMidYMin meet" } });
    svg.setCssProps({ "--inkwright-dungeon-width": `${w * S * 1.6}px` });
    const px = (c: number) => (c - x) * S, py = (r: number) => (r - y) * S;
    for (const room of d.rooms) {
      // createSvg takes several classes as an array.
      const cls = ["inkwright-dungeon-floor", ...(room.corridor ? ["inkwright-dungeon-corridor"] : []), ...(room.here ? ["inkwright-dungeon-here"] : [])];
      for (const [r, c] of room.cells) svg.createSvg("rect", { cls, attr: { x: px(c), y: py(r), width: S, height: S } });
    }
    for (const [r1, c1, r2, c2] of d.walls) svg.createSvg("line", { cls: "inkwright-dungeon-wall", attr: { x1: px(c1), y1: py(r1), x2: px(c2), y2: py(r2) } });
    for (const room of d.rooms) {
      for (const door of room.doors) {
        if (door.state === "blocked") continue;
        // A door is a short bar across the edge of its square.
        const cx = px(door.c) + S / 2, cy = py(door.r) + S / 2;
        const horizontal = door.side === "top" || door.side === "bottom";
        const ex = door.side === "left" ? px(door.c) : door.side === "right" ? px(door.c) + S : cx;
        const ey = door.side === "top" ? py(door.r) : door.side === "bottom" ? py(door.r) + S : cy;
        const half = S * 0.3;
        svg.createSvg("line", {
          cls: ["inkwright-dungeon-door", `inkwright-dungeon-door-${door.state}`],
          attr: { x1: horizontal ? ex - half : ex, y1: horizontal ? ey : ey - half, x2: horizontal ? ex + half : ex, y2: horizontal ? ey : ey + half },
        });
      }
      if (room.mark !== "" && room.cells.length > 0) {
        const mid = room.cells[Math.floor(room.cells.length / 2)];
        svg.createSvg("text", { cls: "inkwright-dungeon-mark", attr: { x: px(mid[1]) + S / 2, y: py(mid[0]) + S / 2, "text-anchor": "middle", "dominant-baseline": "central" } }).setText(room.mark);
      }
    }
  }

  /** The map: the image (or a plain board), lines between linked places, each place (a question mark until revealed, a ring where the player stands, pulsing when a choice goes there), counters and tokens. */
  private renderMap(el: HTMLElement, map: MapView, image: string | null): void {
    const box = el.createDiv({ cls: `inkwright-map${image ? "" : " inkwright-map-board"}` });
    box.setCssProps({ "--inkwright-map-ratio": `${map.width} / ${map.height}` });
    if (image) box.createEl("img", { cls: "inkwright-map-image", attr: { src: image, alt: "" } });
    const svg = box.createSvg("svg", { cls: "inkwright-map-links", attr: { viewBox: `0 0 ${map.width} ${map.height}`, preserveAspectRatio: "none" } });
    const byId = new Map(map.places.map((p) => [p.id, p]));
    const drawn = new Set<string>();
    for (const p of map.places) {
      for (const l of p.links) {
        const q = byId.get(l);
        const key = [p.id, l].sort().join("\n");
        if (!q || drawn.has(key)) continue;
        drawn.add(key);
        svg.createSvg("line", { cls: p.revealed && q.revealed ? "" : "inkwright-link-dim", attr: { x1: p.x, y1: p.y, x2: q.x, y2: q.y } });
      }
    }
    const at = (x: number, y: number) => ({ left: `${(x / map.width) * 100}%`, top: `${(y / map.height) * 100}%` });
    for (const p of map.places) {
      const cls = `inkwright-place${p.revealed ? "" : " inkwright-place-hidden"}${p.here ? " inkwright-place-here" : ""}${p.go === undefined ? "" : " inkwright-place-go"}`;
      const place = p.go === undefined ? box.createDiv({ cls }) : box.createEl("button", { cls });
      place.setCssProps(at(p.x, p.y));
      place.createSpan({ cls: "inkwright-place-name", text: p.revealed ? p.name : "?" });
      if (p.revealed && p.counter) place.createSpan({ cls: "inkwright-place-counter", text: String(p.counter.value), attr: { title: p.counter.name } });
      const go = p.go;
      if (go !== undefined) {
        place.onclick = () => {
          this.afterChoice = true;
          this.controller.choose(go);
        };
      }
    }
    // Tokens stand on their place, side by side when several share one.
    const stacks = new Map<string, number>();
    for (const t of map.tokens) {
      const p = t.at === null ? undefined : byId.get(t.at);
      if (!p) continue;
      const k = stacks.get(p.id) ?? 0;
      stacks.set(p.id, k + 1);
      const token = box.createSpan({ cls: "inkwright-token", text: Array.from(t.name)[0] ?? "", attr: { title: t.name } });
      token.setCssProps({ left: `calc(${(p.x / map.width) * 100}% + ${k * 14}px)`, top: `calc(${(p.y / map.height) * 100}% - 22px)`, ...(t.color ? { "--inkwright-token": t.color } : {}) });
    }
  }

  /** Each hand as a row of cards (tap to pick one, tap again to put it back); the picked card's description shows under the row. */
  private renderHands(el: HTMLElement, hands: HandView[], images: Record<string, string>): void {
    const wrap = el.createDiv({ cls: "inkwright-hands" });
    for (const hand of hands) {
      const box = wrap.createDiv({ cls: "inkwright-hand" });
      const head = box.createDiv({ cls: "inkwright-hand-name", text: hand.name });
      if (hand.cards.length === 0) {
        head.createSpan({ cls: "inkwright-hand-empty", text: T().nothingCarried });
        continue;
      }
      const row = box.createDiv({ cls: "inkwright-cards" });
      const on = this.picked?.hand === hand.id ? hand.cards.find((c) => c.id === this.picked?.card) : undefined;
      for (const card of hand.cards) {
        const art = card.image === undefined ? undefined : images[card.id];
        const button = row.createEl("button", { cls: `inkwright-card${on?.id === card.id ? " inkwright-card-on" : ""}${art ? " inkwright-card-illustrated" : ""}`, attr: { "aria-pressed": String(on?.id === card.id) } });
        if (art) button.createEl("img", { cls: "inkwright-card-art", attr: { src: art, alt: "" } });
        button.createSpan({ cls: "inkwright-card-deck", text: card.deckName });
        button.createSpan({ cls: "inkwright-card-name", text: card.name });
        if (card.attrs?.length) {
          const attrs = button.createDiv({ cls: "inkwright-card-attrs" });
          for (const a of card.attrs) attrs.createSpan({ cls: "inkwright-card-attr", text: `${a.name} ${a.value}`, attr: { title: a.name } });
        }
        button.onclick = () => {
          this.picked = on?.id === card.id ? null : { hand: hand.id, card: card.id };
          // Re-render in place: the rows keep their scroll position, so a card at the far end stays in view.
          const scrolls = Array.from(this.contentEl.querySelectorAll<HTMLElement>(".inkwright-cards")).map((r) => r.scrollLeft);
          this.render();
          this.contentEl.querySelectorAll<HTMLElement>(".inkwright-cards").forEach((r, i) => { r.scrollLeft = scrolls[i] ?? 0; });
        };
      }
      if (on) box.createEl("p", { cls: "inkwright-card-desc", text: on.desc ? T().cardDesc(on.name, on.desc) : on.name });
    }
  }

  private renderHud(el: HTMLElement, game: GameView): void {
    const hud = el.createDiv({ cls: "inkwright-hud" });
    if (game.hud.turn) hud.createDiv({ cls: "inkwright-hud-turn", text: T().turnLine(game.hud.turn.round, game.hud.turn.phase) });
    if (game.hud.party) this.renderParty(hud, game.hud.party);
    for (const r of game.hud.resources) {
      const row = hud.createDiv({ cls: "inkwright-hud-row" });
      row.createSpan({ cls: "inkwright-hud-name", text: r.name });
      if (r.display === "clock") this.renderClock(row, r.value - r.min, r.max - r.min);
      else if (r.display === "track") this.renderTrack(row, r.value - r.min, (r.max - r.min) / 4);
      else {
        const bar = row.createDiv({ cls: "inkwright-hud-bar" });
        const span = Math.max(1, r.max - r.min);
        bar.createDiv({ cls: "inkwright-hud-fill" }).setCssProps({ width: `${Math.round(((r.value - r.min) / span) * 100)}%` });
      }
      row.createSpan({ cls: "inkwright-hud-value", text: `${r.value}/${r.max}` });
      // The player is the game master: a resource marked manual can be changed here (a tick on a track).
      if (r.manual) {
        const down = row.createEl("button", { cls: "inkwright-hud-adjust", text: "−", attr: { "aria-label": T().adjustDown(r.name), title: T().adjustHint } });
        down.disabled = r.value <= r.min;
        down.onclick = () => this.controller.adjustResource(r.id, -1);
        const up = row.createEl("button", { cls: "inkwright-hud-adjust", text: "+", attr: { "aria-label": T().adjustUp(r.name), title: T().adjustHint } });
        up.disabled = r.value >= r.max;
        up.onclick = () => this.controller.adjustResource(r.id, 1);
      }
    }
    // In a party game the gear is on the cards; an empty pack of the protagonist is noise.
    if (game.hud.items && !(game.hud.party && game.hud.items.length === 0)) {
      const row = hud.createDiv({ cls: "inkwright-hud-row inkwright-hud-items" });
      row.createSpan({ cls: "inkwright-hud-name", text: T().inventory });
      if (game.hud.items.length === 0) row.createSpan({ cls: "inkwright-hud-value", text: T().nothingCarried });
      for (const item of game.hud.items) row.createSpan({ cls: "inkwright-item", text: item.name, ...(item.desc ? { title: item.desc } : {}) });
    }
    if (game.hud.decks) {
      const row = hud.createDiv({ cls: "inkwright-hud-row inkwright-hud-items" });
      row.createSpan({ cls: "inkwright-hud-name", text: T().decks });
      for (const d of game.hud.decks) row.createSpan({ cls: "inkwright-item", text: `${d.name} ${d.left}/${d.total}` });
    }
    for (const c of game.hud.companions) {
      const text = [c.name, ...c.resources.map((r) => `${r.name} ${r.value}`)].join(" · ");
      hud.createDiv({ cls: "inkwright-hud-companion", text });
    }
    // Records: their entries, each with a × to take it out, and a box to add one (the player keeps them too).
    for (const rec of game.hud.records ?? []) {
      const box = hud.createDiv({ cls: "inkwright-hud-row inkwright-hud-items inkwright-record" });
      box.createSpan({ cls: "inkwright-hud-name", text: rec.name });
      for (const entry of rec.entries) {
        const chip = box.createSpan({ cls: "inkwright-item" });
        chip.createSpan({ text: entry });
        chip.createEl("button", { cls: "inkwright-record-drop", text: "×", attr: { "aria-label": T().recordDrop(entry), title: T().recordDrop(entry) } }).onclick = () => this.controller.changeRecord(rec.id, "remove", entry);
      }
      const add = box.createEl("input", { cls: "inkwright-record-add", type: "text", placeholder: T().recordAddHere });
      add.onkeydown = (e) => {
        if (e.key !== "Enter" || e.isComposing || add.value.trim() === "") return;
        // The HUD is drawn again after the change: the box of this record gets the focus back, for the next entry.
        this.focusRecord = rec.id;
        this.controller.changeRecord(rec.id, "add", add.value.trim());
      };
      if (this.focusRecord === rec.id) {
        this.focusRecord = null;
        window.setTimeout(() => add.focus(), 0);
      }
    }
  }

  /** A clock of `segments` slices, `filled` of them filled (Blades-style). */
  private renderClock(el: HTMLElement, filled: number, segments: number): void {
    const n = Math.max(1, segments);
    const svg = el.createSvg("svg", { cls: "inkwright-clock", attr: { viewBox: "-1 -1 2 2", width: "28", height: "28" } });
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
      const p = (a: number) => `${(0.92 * Math.cos(a)).toFixed(3)} ${(0.92 * Math.sin(a)).toFixed(3)}`;
      svg.createSvg("path", { cls: i < filled ? "inkwright-clock-on" : "inkwright-clock-off", attr: { d: `M0 0 L${p(a0)} A0.92 0.92 0 0 1 ${p(a1)} Z` } });
    }
  }

  /** A track of `boxes` boxes, each four ticks; `ticks` filled (Ironsworn-style progress). */
  private renderTrack(el: HTMLElement, ticks: number, boxes: number): void {
    const track = el.createDiv({ cls: "inkwright-track" });
    for (let b = 0; b < Math.max(1, boxes); b++) {
      const box = track.createSpan({ cls: "inkwright-track-box" });
      const t = Math.min(4, Math.max(0, ticks - b * 4));
      box.setText(["", "╲", "✕", "✕╲", "✱"][t]);
      if (t === 4) box.addClass("inkwright-track-full");
    }
  }

  /** A card per party member: name, title, stats (bars where there is a maximum), gear; a member who is down is faded. */
  private renderParty(el: HTMLElement, party: NonNullable<GameView["hud"]["party"]>): void {
    const box = el.createDiv({ cls: "inkwright-party" });
    if (party.name) box.createDiv({ cls: "inkwright-party-name", text: party.name });
    const row = box.createDiv({ cls: "inkwright-party-members" });
    for (const m of party.members) {
      const card = row.createDiv({ cls: ["inkwright-party-member", ...(m.down ? ["inkwright-party-down"] : [])] });
      card.createDiv({ cls: "inkwright-party-who", text: m.name });
      if (m.title) card.createDiv({ cls: "inkwright-party-title", text: m.title });
      for (const st of m.stats) {
        const line = card.createDiv({ cls: "inkwright-party-stat" });
        line.createSpan({ cls: "inkwright-party-stat-name", text: st.name });
        if (st.max !== undefined) {
          const bar = line.createDiv({ cls: "inkwright-hud-bar" });
          const share = st.max > 0 ? Math.max(0, Math.min(1, st.value / st.max)) : 0;
          bar.createDiv({ cls: "inkwright-hud-fill" }).setCssProps({ width: `${Math.round(share * 100)}%` });
        }
        line.createSpan({ cls: "inkwright-party-stat-value", text: st.max !== undefined ? `${st.value}/${st.max}` : String(st.value) });
      }
      if (m.gear && m.gear.length > 0) {
        const gear = card.createDiv({ cls: "inkwright-party-gear" });
        for (const item of m.gear) gear.createSpan({ cls: "inkwright-item", text: item.name, ...(item.desc ? { title: item.desc } : {}) });
      }
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
      const dice = r.kind === "check" && r.token ? tokenText(r.token, { fail: T().autoFail, success: T().autoSuccess }) : r.rolls.length > 0 ? r.rolls.join("+") : "—";
      const tr = t.createEl("tr");
      if (r.kind === "dice") {
        const result = r.deck ? r.deck.card : r.record ? r.record.entry : r.table?.text;
        tr.createEl("td", { text: r.deck ? r.deck.name : r.record ? r.record.name : r.table ? `${r.table.name} ${r.formula}` : r.formula });
        tr.createEl("td", { text: r.unknown ? T().badFormula : `${dice} = ${r.total}${result !== undefined ? ` · ${result}` : ""}` });
        continue;
      }
      const name = r.unknown ? `${r.skill} ${T().unknownSkill}` : game.skills.find((k) => k.id === r.skill)?.name ?? r.skill;
      const mods = r.modifiers.map((m) => ` ${m.value > 0 ? "+" : ""}${m.value}`).join("");
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
