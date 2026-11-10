import { T } from "../i18n";
import type { GridView, MapView } from "../game/engine";
import { logLine } from "../play/describe";
import type { GameView } from "./PlayView";

/**
 * The play panel's status column: the HUD (turn, party, resources, items, decks, companions, records), the map,
 * the growing dungeon and the dice log. Each draws what it is given; what the player does goes to the callbacks.
 */

/** What the HUD lets the player do by hand. */
export interface HudActions {
  /** By `delta`, or to `value` when one is given. */
  adjust(id: string, delta: number, value?: number): void;
  changeRecord(id: string, op: "add" | "remove", entry: string): void;
}

/** `record`: a record an entry was just added to; its add box gets the focus back after the redraw (and it is cleared). */
export function renderHud(el: HTMLElement, game: GameView, act: HudActions, focus: { record: string | null }): void {
  const t = T();
  const hud = el.createDiv({ cls: "inkwright-hud" });
  if (game.hud.turn) hud.createDiv({ cls: "inkwright-hud-turn", text: t.turnLine(game.hud.turn.round, game.hud.turn.phase) });
  if (game.hud.party) renderParty(hud, game.hud.party);
  for (const r of game.hud.resources) {
    const row = hud.createDiv({ cls: "inkwright-hud-row" });
    row.createSpan({ cls: "inkwright-hud-name", text: r.name });
    if (r.display === "clock") renderClock(row, r.value - r.min, r.max - r.min);
    else if (r.display === "track") renderTrack(row, r.value - r.min, (r.max - r.min) / 4);
    else renderBar(row, (r.value - r.min) / Math.max(1, r.max - r.min));
    const value = row.createSpan({ cls: "inkwright-hud-value", text: `${r.value}/${r.max}` });
    // The player is the game master: a resource marked manual can be changed here (a tick on a track), or set by typing its value.
    if (r.manual) {
      value.addClass("inkwright-hud-value-set");
      value.setAttrs({ role: "button", tabindex: "0", title: t.setValue(r.name), "aria-label": t.setValue(r.name) });
      const edit = () => {
        const input = createEl("input", { type: "number", cls: "inkwright-hud-set", value: String(r.value), attr: { min: String(r.min), max: String(r.max), "aria-label": t.setValue(r.name) } });
        value.replaceWith(input);
        let gone = false;
        const done = (keep: boolean) => {
          if (gone) return;
          gone = true;
          const n = Number(input.value);
          input.replaceWith(value);
          if (keep && input.value.trim() !== "" && Number.isFinite(n) && n !== r.value) act.adjust(r.id, 0, Math.round(n));
        };
        input.onkeydown = (e) => {
          if (e.isComposing) return;
          if (e.key === "Enter") done(true);
          else if (e.key === "Escape") done(false);
        };
        input.onblur = () => done(true);
        input.focus();
        input.select();
      };
      value.onclick = edit;
      value.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          edit();
        }
      };
      const down = row.createEl("button", { cls: "inkwright-hud-adjust", text: "−", attr: { "aria-label": t.adjustDown(r.name), title: t.adjustHint } });
      down.disabled = r.value <= r.min;
      down.onclick = () => act.adjust(r.id, -1);
      const up = row.createEl("button", { cls: "inkwright-hud-adjust", text: "+", attr: { "aria-label": t.adjustUp(r.name), title: t.adjustHint } });
      up.disabled = r.value >= r.max;
      up.onclick = () => act.adjust(r.id, 1);
    }
  }
  // In a party game the gear is on the cards; an empty pack of the protagonist is noise.
  if (game.hud.items && !(game.hud.party && game.hud.items.length === 0)) {
    const row = chipRow(hud, t.inventory);
    if (game.hud.items.length === 0) row.createSpan({ cls: "inkwright-hud-value", text: t.nothingCarried });
    for (const item of game.hud.items) row.createSpan({ cls: "inkwright-item", text: item.name, ...(item.desc ? { title: item.desc } : {}) });
  }
  if (game.hud.decks) {
    const row = chipRow(hud, t.decks);
    for (const d of game.hud.decks) row.createSpan({ cls: "inkwright-item", text: `${d.name} ${d.left}/${d.total}` });
  }
  for (const c of game.hud.companions) {
    hud.createDiv({ cls: "inkwright-hud-companion", text: [c.name, ...c.resources.map((r) => `${r.name} ${r.value}`)].join(" · ") });
  }
  // Records: their entries, each with a × to take it out, and a box to add one (the player keeps them too).
  for (const rec of game.hud.records ?? []) {
    const box = chipRow(hud, rec.name, "inkwright-record");
    for (const entry of rec.entries) {
      const chip = box.createSpan({ cls: "inkwright-item" });
      chip.createSpan({ text: entry });
      chip.createEl("button", { cls: "inkwright-record-drop", text: "×", attr: { "aria-label": t.recordDrop(entry), title: t.recordDrop(entry) } }).onclick = () => act.changeRecord(rec.id, "remove", entry);
    }
    const add = box.createEl("input", { cls: "inkwright-record-add", type: "text", placeholder: t.recordAddHere });
    add.onkeydown = (e) => {
      if (e.key !== "Enter" || e.isComposing || add.value.trim() === "") return;
      focus.record = rec.id;
      act.changeRecord(rec.id, "add", add.value.trim());
    };
    if (focus.record === rec.id) {
      focus.record = null;
      window.setTimeout(() => add.focus(), 0);
    }
  }
}

/** A HUD row of chips under a name (items, decks, a record's entries). */
function chipRow(hud: HTMLElement, name: string, extra?: string): HTMLElement {
  const row = hud.createDiv({ cls: `inkwright-hud-row inkwright-hud-items${extra ? ` ${extra}` : ""}` });
  row.createSpan({ cls: "inkwright-hud-name", text: name });
  return row;
}

/** A bar filled to `share` (0..1). */
function renderBar(el: HTMLElement, share: number): void {
  const bar = el.createDiv({ cls: "inkwright-hud-bar" });
  bar.createDiv({ cls: "inkwright-hud-fill" }).setCssProps({ width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%` });
}

/** A clock of `segments` slices, `filled` of them filled (Blades-style). */
function renderClock(el: HTMLElement, filled: number, segments: number): void {
  const n = Math.max(1, segments);
  const svg = el.createSvg("svg", { cls: "inkwright-clock", attr: { viewBox: "-1 -1 2 2", width: "28", height: "28" } });
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const p = (a: number) => `${(0.92 * Math.cos(a)).toFixed(3)} ${(0.92 * Math.sin(a)).toFixed(3)}`;
    svg.createSvg("path", { cls: i < filled ? "inkwright-clock-on" : "inkwright-clock-off", attr: { d: `M0 0 L${p(a0)} A0.92 0.92 0 0 1 ${p(a1)} Z` } });
  }
}

/** A track of `boxes` boxes, each four ticks; `ticks` filled (Ironsworn-style progress). */
function renderTrack(el: HTMLElement, ticks: number, boxes: number): void {
  const track = el.createDiv({ cls: "inkwright-track" });
  for (let b = 0; b < Math.max(1, boxes); b++) {
    const box = track.createSpan({ cls: "inkwright-track-box" });
    const n = Math.min(4, Math.max(0, ticks - b * 4));
    box.setText(["", "╲", "✕", "✕╲", "✱"][n]);
    if (n === 4) box.addClass("inkwright-track-full");
  }
}

/** A card per party member: name, title, stats (bars where there is a maximum), gear; a member who is down is faded. */
function renderParty(el: HTMLElement, party: NonNullable<GameView["hud"]["party"]>): void {
  const box = el.createDiv({ cls: "inkwright-party" });
  if (party.name) box.createDiv({ cls: "inkwright-party-name", text: party.name });
  const row = box.createDiv({ cls: "inkwright-party-members" });
  for (const m of party.members) {
    const card = row.createDiv({ cls: ["inkwright-party-member", ...(m.down ? ["inkwright-party-down"] : [])] });
    card.createDiv({ cls: "inkwright-party-who", text: m.name });
    if (m.title) card.createDiv({ cls: "inkwright-party-title", text: m.title });
    for (const st of m.stats) statLine(card, st);
    if (m.gear && m.gear.length > 0) {
      const gear = card.createDiv({ cls: "inkwright-party-gear" });
      for (const item of m.gear) gear.createSpan({ cls: "inkwright-item", text: item.name, ...(item.desc ? { title: item.desc } : {}) });
    }
  }
}

/** A stat on a card: its name, a bar when it has a maximum, the value. */
function statLine(card: HTMLElement, st: { name: string; value: number; max?: number }): void {
  const line = card.createDiv({ cls: "inkwright-party-stat" });
  line.createSpan({ cls: "inkwright-party-stat-name", text: st.name });
  if (st.max !== undefined) renderBar(line, st.max > 0 ? st.value / st.max : 0);
  line.createSpan({ cls: "inkwright-party-stat-value", text: st.max !== undefined ? `${st.value}/${st.max}` : String(st.value) });
}

/**
 * The entities in play (RPG PRD §4.1), one row of cards per kind that has any, between the text and the choices:
 * the foes the choices are about. Each kind folds (a phone has little room); `folded` holds the folded kinds.
 */
export function renderKinds(el: HTMLElement, kinds: NonNullable<GameView["hud"]["kinds"]>, folded: Set<string>): void {
  for (const k of kinds) {
    if (k.entities.length === 0) continue;
    const box = el.createEl("details", { cls: "inkwright-kind" });
    box.open = !folded.has(k.id);
    box.addEventListener("toggle", () => {
      if (box.open) folded.delete(k.id);
      else folded.add(k.id);
    });
    box.createEl("summary", { text: `${k.name} · ${k.entities.length}` });
    const row = box.createDiv({ cls: "inkwright-party-members" });
    for (const e of k.entities) {
      const card = row.createDiv({ cls: ["inkwright-party-member", ...(e.down ? ["inkwright-party-down"] : [])] });
      card.createDiv({ cls: "inkwright-party-who", text: e.name });
      for (const st of e.stats) statLine(card, st);
    }
  }
}

/** The map: the image (or a plain board), lines between linked places, each place (a question mark until revealed, a ring where the player stands, a button when a choice goes there), counters and tokens. */
export function renderMap(el: HTMLElement, map: MapView, image: string | null, go: (choice: number) => void): void {
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
  for (const p of map.places) {
    const cls = `inkwright-place${p.revealed ? "" : " inkwright-place-hidden"}${p.here ? " inkwright-place-here" : ""}${p.go === undefined ? "" : " inkwright-place-go"}`;
    const place = p.go === undefined ? box.createDiv({ cls }) : box.createEl("button", { cls });
    place.setCssProps({ left: `${(p.x / map.width) * 100}%`, top: `${(p.y / map.height) * 100}%` });
    place.createSpan({ cls: "inkwright-place-name", text: p.revealed ? p.name : "?" });
    if (p.revealed && p.counter) place.createSpan({ cls: "inkwright-place-counter", text: String(p.counter.value), attr: { title: p.counter.name } });
    const index = p.go;
    if (index !== undefined) place.onclick = () => go(index);
  }
  // Tokens stand on their place, side by side when several share one.
  const stacks = new Map<string, number>();
  for (const tk of map.tokens) {
    const p = tk.at === null ? undefined : byId.get(tk.at);
    if (!p) continue;
    const k = stacks.get(p.id) ?? 0;
    stacks.set(p.id, k + 1);
    const token = box.createSpan({ cls: "inkwright-token", text: Array.from(tk.name)[0] ?? "", attr: { title: tk.name } });
    token.setCssProps({ left: `calc(${(p.x / map.width) * 100}% + ${k * 14}px)`, top: `calc(${(p.y / map.height) * 100}% - 22px)`, ...(tk.color ? { "--inkwright-token": tk.color } : {}) });
  }
}

/** The growing dungeon on its squares: floor per room (the room the party is in lit), walls, doors (free ones bright), a room's note in its middle. */
export function renderDungeon(el: HTMLElement, d: GridView): void {
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

/** Every roll of the run, newest first, folded until opened. */
export function renderDiceLog(el: HTMLElement, game: GameView, open: boolean, toggled: (open: boolean) => void): void {
  const t = T();
  const box = el.createEl("details", { cls: "inkwright-inspector inkwright-dice" });
  box.open = open;
  box.addEventListener("toggle", () => toggled(box.open));
  box.createEl("summary", { text: `${t.diceLog}(${game.rolls.length})` });
  if (game.rolls.length === 0) {
    box.createDiv({ cls: "inkwright-inspector-empty", text: t.noRolls });
    return;
  }
  const table = box.createEl("table");
  for (const r of [...game.rolls].reverse()) {
    const tr = table.createEl("tr");
    for (const cell of logLine(r, game.skills)) tr.createEl("td", { text: cell });
  }
}
