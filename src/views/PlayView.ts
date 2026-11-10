import { ItemView, Keymap, setIcon, type WorkspaceLeaf } from "obsidian";
import type { Flow } from "../compile/compile";
import type { Diagnostic } from "../compile/diagnostics";
import { T, getLanguage } from "../i18n";
import type { Inspection } from "../play/inspect";
import { inputOf, isWrite } from "../play/input";
import { splitLinks, withoutLinks } from "../play/links";
import { STORY_LANGUAGES, type Choice, type Paragraph, type PlacedAside } from "../play/session";
import { ODDS, type Odds } from "../play/oracle";
import { mergeAsides } from "../play/journal";
import type { ChoiceCheck, ChoiceNeed, ChoicePlay, HandView, HudView, GridView, MapView, RollRecord } from "../game/engine";
import { fxOf } from "../game/config";
import { describeStop, noteText, pickHint } from "../play/describe";
import { animateRolls, playFx, renderAside, renderRoll } from "./cards";
import { renderDiceLog, renderDungeon, renderHud, renderKinds, renderMap } from "./status";

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
  /** What the replay noticed without stopping: steps found by a guess, hand changes skipped (their variable is gone), the first step (1-based) whose outcome changed. */
  note?: { guesses: number; skipped: number; drift: number | null } | null;
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
  renameSave(id: string, name: string): Promise<void>;
  startAt(path: string | null): void;
  /** Takes a choice; a `#play` choice is taken with the id of a card picked from its hand, an `#input` choice with the text typed. */
  choose(index: number, value?: string | string[]): void;
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
  /** Kinds of entities folded away (by kind id); kept across redraws. */
  private foldedKinds = new Set<string>();
  /** The save whose name is being edited in the list. */
  private renaming: string | null = null;
  private diceOpen = false;
  /** Story and paragraph count last rendered, to scroll new text into view. */
  private shownRoot: string | null = null;
  private shownLog = 0;
  /** Set when a choice button was clicked, so the next text that arrives is scrolled to. */
  private afterChoice = false;
  /** The card tapped in a hand, for the next `#play` choice; forgotten when the choices change. */
  private picked: { hand: string; cards: string[] } | null = null;
  private pickedAt = "";
  /** The story whose earlier paragraphs the player asked to see; they are hidden again for another story. */
  private showAllFor: string | null = null;
  /** Player mode: the problems the story has, shown when its badge is clicked. */
  private problemsOpen = false;
  /** A record an entry was just added to: its add box is focused again after the redraw. */
  private focus: { record: string | null } = { record: null };
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
    if (s.hasStory && s.game) renderHud(side, s.game, { adjust: (id, d, value) => this.controller.adjustResource(id, d, value), changeRecord: (id, op, e) => this.controller.changeRecord(id, op, e) }, this.focus);
    if (s.hasStory && s.game?.map) {
      renderMap(side, s.game.map, s.game.mapImage, (index) => {
        this.afterChoice = true;
        this.controller.choose(index);
      });
    }
    if (s.hasStory && s.game?.dungeon) renderDungeon(side, s.game.dungeon);
    if (s.inspection && !player) this.renderInspector(main, s.inspection);
    if (s.hasStory && s.game) {
      renderDiceLog(side, s.game, this.diceOpen, (open) => {
        this.diceOpen = open;
      });
    }
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
      line.createSpan({ cls: "inkwright-turn-text", text: withoutLinks(s.chosen?.text ?? "") });
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
        if (a.at >= first) newCards.push(renderAside(story, a, s.game));
      }
    };
    s.log.forEach((p, i) => {
      if (i < first) return;
      asidesBefore(i);
      if (s.chosen && s.chosen.at === i) turnLine();
      const turn = s.game?.turns[i] ?? null;
      if (s.game && turn !== null && (i === first || turn !== lastTurn)) {
        for (const r of rollsByTurn.get(turn) ?? []) {
          const card = renderRoll(story, r, s.game);
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
      this.appendLinked(para, p.text, s.root ?? "");
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
    // How many cards a choice on screen takes from each hand, so its row lets that many be picked.
    const most: Record<string, number> = {};
    for (const p of s.game?.plays ?? []) if (p) most[p.hand] = Math.max(most[p.hand] ?? 1, p.max);
    // The entities in play (foes, summons) sit right above the choices that are about them.
    if (s.game?.hud.kinds) renderKinds(main, s.game.hud.kinds, this.foldedKinds);
    if (s.game && hands.length > 0) this.renderHands(main, hands, s.game.cardImages, most);

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
      // The cards picked in this choice's hand; it goes when there are as many as it takes (#play:hand:1-3).
      const chosen = play && this.picked?.hand === play.hand ? play.cards.filter((k) => this.picked?.cards.includes(k.id)) : [];
      const ready = play !== null && chosen.length >= play.min && chosen.length <= play.max;
      // An #input choice (not a #play one) gets a text field above its button; the button waits for a line.
      const variable = play ? null : inputOf(c);
      // #write asks for a paragraph: a box of several lines (Enter is a new line; Ctrl/Cmd+Enter takes the choice).
      const multiline = variable !== null && isWrite(c);
      const field: HTMLInputElement | HTMLTextAreaElement | null = variable === null ? null
        : multiline ? choices.createEl("textarea", { cls: "inkwright-input inkwright-write", placeholder: T().writeHere, text: this.typed.get(c.index) ?? "" })
        : choices.createEl("input", { cls: "inkwright-input", type: "text", placeholder: T().typeHere, value: this.typed.get(c.index) ?? "" });
      // A [[note]] in a choice shows its text (a button cannot hold a link).
      const label = withoutLinks(c.text);
      const button = choices.createEl("button", { text: ready ? `${label} · ${chosen.map((k) => k.name).join(" + ")}` : label, cls: "inkwright-choice" });
      const check = s.game?.checks[i] ?? null;
      if (check) this.renderCheck(button, check, s.game);
      const needs = s.game?.needs[i] ?? [];
      for (const need of needs) {
        button.createSpan({ cls: `inkwright-need${need.has ? "" : " inkwright-need-missing"}`, text: `${T().needs} ${need.name}` });
      }
      // A #play choice waits for a card from its hand; with no card to play it is locked like a missing item.
      if (play && !ready) {
        button.createSpan({ cls: "inkwright-choice-pick", text: pickHint(play) });
      }
      const locked = needs.some((n) => !n.has) || (play !== null && !ready);
      if (locked) {
        button.disabled = true;
        button.addClass("inkwright-choice-locked");
      }
      button.onclick = () => {
        this.afterChoice = true;
        this.controller.choose(c.index, field ? field.value : play ? (play.max > 1 ? chosen.map((k) => k.id) : chosen[0]?.id) : undefined);
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
      for (const timer of animateRolls(newCards)) this.registerInterval(timer);
      playFx(story, s.log.slice(from).flatMap((p) => fxOf(p.tags)));
    } else if (changed) {
      choices.scrollIntoView({ block: "end" });
    }
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

  /** A paragraph's text, its `[[note]]` links drawn as links into the vault: a click opens the note, hovering previews it (desktop). */
  private appendLinked(para: HTMLElement, text: string, sourcePath: string): void {
    for (const part of splitLinks(text)) {
      const target = part.link;
      if (target === undefined) {
        para.appendText(part.text);
        continue;
      }
      const a = para.createEl("a", { cls: "internal-link", text: part.text, attr: { "data-href": target, href: target } });
      // Opened as links in notes are: a click here, Ctrl/Cmd (or a middle click) a new tab, Ctrl/Cmd+Alt a split.
      const open = (e: MouseEvent) => {
        e.preventDefault();
        void this.app.workspace.openLinkText(target, sourcePath, e.button === 1 ? "tab" : Keymap.isModEvent(e));
      };
      a.onclick = open;
      a.addEventListener("auxclick", (e) => {
        if (e.button === 1) open(e);
      });
      a.addEventListener("mouseover", (event) => {
        this.app.workspace.trigger("hover-link", { event, source: PLAY_VIEW_TYPE, hoverParent: this, targetEl: a, linktext: target, sourcePath });
      });
    }
  }

  /** Says where and why a saved run stopped short of where it had got to, and that the rest is kept. */
  private renderStopped(el: HTMLElement, st: NonNullable<PlayState["stopped"]>): void {
    const t = T();
    const stop = describeStop(st);
    const note = el.createDiv({ cls: "inkwright-run-note inkwright-stopped" });
    note.createSpan({ text: stop.text });
    const buttons = note.createDiv({ cls: "inkwright-run-note-buttons" });
    if (stop.byIndex) buttons.createEl("button", { text: t.continueByIndex }).onclick = () => this.controller.continueByIndex();
    if (stop.older) buttons.createEl("button", { text: t.useOlder }).onclick = () => this.controller.useOlder();
    buttons.createEl("button", { text: t.dismiss }).onclick = () => this.controller.dismissStop();
  }

  /** A replay that went through but noticed something: choices found by a guess, an outcome that changed. */
  private renderNote(el: HTMLElement, n: NonNullable<PlayState["note"]>): void {
    const t = T();
    const note = el.createDiv({ cls: "inkwright-run-note inkwright-stopped" });
    note.createSpan({ text: noteText(n) });
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

  /** The skill, difficulty and odds of a check choice, on the button. */
  private renderCheck(button: HTMLElement, check: ChoiceCheck, game: GameView | null): void {
    const name = game?.skills.find((k) => k.id === check.skill)?.name ?? check.skill;
    const pct = Math.round(check.chance.success * 100);
    const badge = button.createSpan({ cls: "inkwright-check", text: `${name} ${check.difficulty} · ${pct}%` });
    if (check.red) badge.createSpan({ cls: "inkwright-check-red", text: ` · ${T().redCheck}` });
    const parts = [`${name} ${check.level}`, ...check.modifiers.map((m) => `${m.value > 0 ? "+" : ""}${m.value} ${m.source}`)];
    button.title = parts.join(", ");
  }

  /** Each hand as a row of cards (tap to pick one, tap again to put it back); the picked card's description shows under the row. */
  private renderHands(el: HTMLElement, hands: HandView[], images: Record<string, string>, most: Record<string, number> = {}): void {
    const wrap = el.createDiv({ cls: "inkwright-hands" });
    for (const hand of hands) {
      const box = wrap.createDiv({ cls: "inkwright-hand" });
      const head = box.createDiv({ cls: "inkwright-hand-name", text: hand.name });
      if (hand.cards.length === 0) {
        head.createSpan({ cls: "inkwright-hand-empty", text: T().nothingCarried });
        continue;
      }
      const row = box.createDiv({ cls: "inkwright-cards" });
      // The cards picked here; as many as a choice on screen takes from this hand (one for most).
      const picked = this.picked?.hand === hand.id ? this.picked.cards : [];
      const max = Math.max(1, most[hand.id] ?? 1);
      const on = hand.cards.find((c) => c.id === picked[picked.length - 1]);
      for (const card of hand.cards) {
        const art = card.image === undefined ? undefined : images[card.id];
        const isOn = picked.includes(card.id);
        const button = row.createEl("button", { cls: `inkwright-card${isOn ? " inkwright-card-on" : ""}${art ? " inkwright-card-illustrated" : ""}`, attr: { "aria-pressed": String(isOn) } });
        if (art) button.createEl("img", { cls: "inkwright-card-art", attr: { src: art, alt: "" } });
        button.createSpan({ cls: "inkwright-card-deck", text: card.deckName });
        button.createSpan({ cls: "inkwright-card-name", text: card.name });
        if (card.attrs?.length) {
          const attrs = button.createDiv({ cls: "inkwright-card-attrs" });
          for (const a of card.attrs) attrs.createSpan({ cls: "inkwright-card-attr", text: `${a.name} ${a.value}`, attr: { title: a.name } });
        }
        button.onclick = () => {
          // Tap to pick, tap again to put back; with room for one, another card takes its place; when full, the oldest goes.
          const next = isOn ? picked.filter((id) => id !== card.id) : max === 1 ? [card.id] : [...picked, card.id].slice(-max);
          this.picked = next.length > 0 ? { hand: hand.id, cards: next } : null;
          // Re-render in place: the rows keep their scroll position, so a card at the far end stays in view.
          const scrolls = Array.from(this.contentEl.querySelectorAll<HTMLElement>(".inkwright-cards")).map((r) => r.scrollLeft);
          this.render();
          this.contentEl.querySelectorAll<HTMLElement>(".inkwright-cards").forEach((r, i) => { r.scrollLeft = scrolls[i] ?? 0; });
        };
      }
      if (on) box.createEl("p", { cls: "inkwright-card-desc", text: on.desc ? T().cardDesc(on.name, on.desc) : on.name });
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
      if (this.renaming === slot.id) {
        // The name edited in place: Enter keeps it, Escape (or leaving the box) leaves it as it was.
        const input = info.createEl("input", { type: "text", value: slot.name, cls: "inkwright-save-rename" });
        const done = (keep: boolean) => {
          if (this.renaming !== slot.id) return;
          this.renaming = null;
          if (keep && input.value.trim() !== "" && input.value.trim() !== slot.name) void this.controller.renameSave(slot.id, input.value);
          else this.render();
        };
        input.onkeydown = (e) => {
          if (e.isComposing) return;
          if (e.key === "Enter") done(true);
          else if (e.key === "Escape") done(false);
        };
        input.onblur = () => done(false);
        window.setTimeout(() => input.select(), 0);
      } else {
        info.createDiv({ text: slot.name });
      }
      info.createDiv({ cls: "inkwright-save-time", text: new Date(slot.savedAt).toLocaleString(getLanguage() === "zh" ? "zh-CN" : "en") });
      row.createEl("button", { text: T().load }).onclick = () => this.controller.loadGame(slot.id);
      row.createEl("button", { text: T().rename }).onclick = () => {
        this.renaming = slot.id;
        this.render();
      };
      // A save cannot be got back: the first tap asks, a second within a few seconds deletes.
      const del = row.createEl("button", { text: T().delete });
      let armed = false;
      del.onclick = () => {
        if (armed) {
          void this.controller.deleteSave(slot.id);
          return;
        }
        armed = true;
        del.setText(T().confirmDelete);
        del.addClass("mod-warning");
        window.setTimeout(() => {
          armed = false;
          del.setText(T().delete);
          del.removeClass("mod-warning");
        }, 3000);
      };
    }
  }
}
