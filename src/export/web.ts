import { FX, type GameConfig } from "../game/config";
import { getLanguage, stringsFor, type Language } from "../i18n";
import { STORY_LANGUAGES } from "../play/session";

export interface WebPageOptions {
  title: string;
  /** Compiled story JSON (story.ToJson()). */
  storyJson: string;
  /** inkjs runtime source (dist/ink.js). */
  runtime: string;
  /** Key for the player's progress in localStorage; use the main story path. */
  id: string;
  /** The story's language variable when it is bilingual (PlaySession.languageVar). */
  languageVar?: string | null;
  /** Game mode: the game's config and the engine script (virtual:game-engine) to embed. */
  game?: GameConfig;
  engine?: string;
  /** The map's image as a data URI (the page carries it along). */
  mapImage?: string;
  /** Card art by card id, as data URIs. */
  cardImages?: Record<string, string>;
}

/** Title from a `# title: ...` global tag, else the fallback. */
export function storyTitle(globalTags: string[] | null, fallback: string): string {
  for (const tag of globalTags ?? []) {
    const m = /^\s*title\s*:\s*(.+?)\s*$/i.exec(tag);
    if (m) return m[1];
  }
  return fallback;
}

/** Where to write the page: next to the main story, named after its folder when the file is main.ink. */
export function exportFileName(rootPath: string): string {
  const slash = rootPath.lastIndexOf("/");
  const dir = slash < 0 ? "" : rootPath.slice(0, slash);
  const base = rootPath.slice(slash + 1).replace(/\.ink$/i, "");
  const name = base.toLowerCase() === "main" && dir !== "" ? dir.slice(dir.lastIndexOf("/") + 1) : base;
  return (dir === "" ? "" : dir + "/") + name + ".html";
}

/** FNV-1a; tells a re-exported story apart so old progress is not loaded into it. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Keeps embedded text from closing its <script> element early. */
function scriptSafe(s: string): string {
  return s.replace(/<\/script/gi, "<\\/script");
}

/** A self-contained HTML page that plays the story; progress is kept in the browser's localStorage. */
export function buildWebPage(o: WebPageOptions): string {
  const strings = (lang: Language) => {
    const t = stringsFor(lang);
    return {
      restart: t.restart, back: t.back, ended: t.ended, language: t.storyLanguage, loop: t.infiniteLoop(LOOP_SECONDS),
      character: t.character, status: t.status, diceLog: t.diceLog, bands: t.bands, redCheck: t.redCheck, unknownSkill: t.unknownSkill,
      inventory: t.inventory, nothingCarried: t.nothingCarried, needs: t.needs, decks: t.decks, pickCard: t.pickCard,
    };
  };
  // "<" only occurs inside JSON strings, where \u003c is equivalent.
  const story = o.storyJson.replace(/</g, "\\u003c");
  const config = JSON.stringify({
    id: o.id,
    version: hash(o.storyJson),
    ui: getLanguage(),
    strings: { zh: strings("zh"), en: strings("en") },
    languageVar: o.languageVar ?? null,
    mapImage: o.mapImage ?? null,
    cardImages: o.cardImages ?? {},
    languages: STORY_LANGUAGES,
    loopMs: LOOP_SECONDS * 1000,
    fx: FX,
    game: o.game && o.engine ? o.game : null,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${getLanguage() === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${escapeHtml(o.title)}</h1>
<div id="hud" hidden></div>
<div id="map" hidden></div>
<div id="story"></div>
<div id="hands" hidden></div>
<div id="choices"></div>
<details id="dice" hidden><summary></summary><ul></ul></details>
<p id="end" hidden></p>
<nav><button id="back" type="button"></button><button id="restart" type="button"></button><select id="character" hidden></select><select id="language" hidden></select></nav>
</main>
<script type="application/json" id="ink-story">${story}</script>
<script>${scriptSafe(o.runtime)}</script>
${o.game && o.engine ? `<script>${scriptSafe(o.engine)}</script>\n` : ""}<script>var INKWRIGHT = ${config};
${PLAYER}</script>
</body>
</html>
`;
}

/** How long one step may run in the exported player before it is treated as an infinite loop. */
const LOOP_SECONDS = 2;

const CSS = `
:root { --bg: #fbfaf7; --fg: #222; --muted: #888; --accent: #7a4fd0; --line: #ddd; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1b1f; --fg: #e6e3ea; --muted: #8a8690; --accent: #b79cff; --line: #3a3840; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 18px/1.75 -apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif; }
main { max-width: 40em; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 1.5em; margin: 0 0 1.2em; }
#story p { margin: 0 0 0.9em; white-space: pre-wrap; }
#story p.chosen { color: var(--muted); font-style: italic; margin-top: 1.4em; }
#story p.error { color: #c33; }
#choices { margin-top: 1.2em; display: flex; flex-direction: column; gap: 8px; }
#choices button { text-align: left; font: inherit; color: var(--accent); background: none;
  border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; cursor: pointer; }
#choices button:hover { border-color: var(--accent); }
#end { color: var(--muted); text-align: center; margin-top: 2em; }
nav { margin-top: 3em; display: flex; gap: 12px; justify-content: center; }
nav button { font: inherit; font-size: 0.8em; color: var(--muted); background: none; border: none;
  cursor: pointer; padding: 6px 10px; }
nav select { font: inherit; font-size: 0.8em; color: var(--muted); background: none; border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 6px; }
nav button:disabled { opacity: 0.4; cursor: default; }
#hud { font-size: 0.8em; color: var(--muted); margin-bottom: 1.4em; line-height: 1.6; }
#hud .name { color: var(--fg); font-weight: 600; margin-right: 0.4em; }
#story p.voice { border-left: 3px solid var(--voice, var(--accent)); padding-left: 10px; }
#story p.voice .who { color: var(--voice, var(--accent)); font-weight: 600; font-size: 0.85em; margin-right: 0.5em; }
#choices button .check { display: block; font-size: 0.75em; color: var(--muted); }
#choices button .need { display: block; font-size: 0.75em; color: var(--muted); }
#choices button .need.missing { color: #c33; }
#choices button:disabled { opacity: 0.55; cursor: default; }
#choices button:disabled:hover { border-color: var(--line); }
#map { position: relative; width: 100%; margin: 0 0 1.2em; border-radius: 8px; overflow: hidden; background: var(--line); }
#map img { display: block; width: 100%; height: 100%; }
#map svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
#map line { stroke: var(--muted); stroke-width: 2; vector-effect: non-scaling-stroke; }
#map line.dim { stroke-dasharray: 4 4; opacity: 0.5; }
#map .place { position: absolute; transform: translate(-50%, -50%); min-width: 44px; min-height: 32px; padding: 2px 8px; display: flex; align-items: center; justify-content: center; gap: 4px;
  border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; font-size: 0.8em; white-space: nowrap; }
#map button.place { cursor: pointer; }
#map .place.unknown { color: var(--muted); border-style: dashed; }
#map .place.here { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
#map .place.go { border-color: var(--accent); animation: go 1.2s ease-in-out infinite; }
@keyframes go { 50% { box-shadow: 0 0 0 4px var(--accent); } }
#map .counter { min-width: 18px; padding: 0 4px; border-radius: 9px; background: var(--accent); color: #fff; font-size: 0.75em; text-align: center; }
#map .token { position: absolute; width: 22px; height: 22px; border-radius: 50%; background: #c33; color: #fff; font-size: 0.7em; display: flex; align-items: center; justify-content: center; transform: translate(-50%, -50%); border: 2px solid var(--bg); pointer-events: none; }
@media (prefers-reduced-motion: reduce) { #map .place.go { animation: none; } }
#hands { margin-top: 1.2em; }
#hands .hand { margin-bottom: 0.5em; }
#hands .name { font-size: 0.8em; color: var(--muted); }
#hands .cards { display: flex; gap: 8px; overflow-x: auto; padding: 8px 2px 4px; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; }
#hands .card { flex: 0 0 auto; width: 92px; height: auto; min-height: 120px; padding: 8px; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start;
  text-align: left; font: inherit; font-size: 0.85em; line-height: 1.3; color: var(--fg); background: none; border: 1px solid var(--line); border-radius: 8px; cursor: pointer;
  scroll-snap-align: start; transition: transform 120ms ease, border-color 120ms ease; }
#hands .card.illustrated { width: 108px; padding: 0 0 8px; overflow: hidden; }
#hands .card img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; margin-bottom: 6px; border-bottom: 1px solid var(--line); }
#hands .card.illustrated .deck, #hands .card.illustrated .cardname, #hands .card.illustrated .attrs { padding: 0 8px; }
#hands .card .attrs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
#hands .card .attr { padding: 0 6px; border-radius: 9px; background: var(--line); color: var(--muted); font-size: 0.75em; white-space: nowrap; }
#hands .card .deck { font-size: 0.75em; color: var(--muted); }
#hands .card .cardname { font-weight: 600; }
#hands .card.on { border-color: var(--accent); transform: translateY(-6px); }
#hands .desc { margin: 0.3em 0 0; font-size: 0.85em; color: var(--muted); }
@media (prefers-reduced-motion: reduce) { #hands .card { transition: none; } #hands .card.on { transform: none; } }
#dice { font-size: 0.8em; color: var(--muted); margin-top: 1.2em; }
#dice summary { cursor: pointer; }
#dice ul { margin: 0.4em 0 0; padding-left: 1.2em; }
#story .roll { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5em; margin: -0.4em 0 0.9em; padding: 0.3em 0.8em;
  border-left: 3px solid var(--band, var(--muted)); background: rgba(128, 128, 128, 0.08); border-radius: 0 6px 6px 0;
  font-size: 0.85em; color: var(--muted); }
#story .roll.b0 { --band: #a01; } #story .roll.b1 { --band: #c33; } #story .roll.b2 { --band: #c90; }
#story .roll.b3 { --band: #2a7; } #story .roll.b4 { --band: #1b9; }
#story .roll .skill { font-weight: 600; color: var(--fg); }
#story .roll .die { display: inline-block; min-width: 1.6em; margin-right: 0.2em; padding: 0 0.3em; border: 1px solid var(--line);
  border-radius: 5px; text-align: center; color: var(--fg); font-variant-numeric: tabular-nums; }
#story .roll .band { font-weight: 600; color: var(--band, var(--fg)); }
#story .roll.rolling .die { animation: tumble 0.14s linear infinite alternate; }
#story .roll.rolling .band { visibility: hidden; }
@keyframes tumble { from { transform: rotate(-8deg) scale(1.05); } to { transform: rotate(8deg) scale(0.95); } }
#story.fx-shake { animation: shake 0.5s; }
#story.fx-flash::after, #story.fx-dark::after, #story.fx-pulse::after { content: ""; position: fixed; inset: 0; pointer-events: none; }
#story.fx-flash::after { background: #fff; animation: flash 0.6s both; }
#story.fx-dark::after { background: #000; animation: dark 1.8s both; }
#story.fx-pulse::after { background: radial-gradient(ellipse at center, transparent 50%, rgba(170, 0, 0, 0.55)); animation: pulse 1.4s both; }
@keyframes shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-7px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
@keyframes flash { from { opacity: 1; } to { opacity: 0; } }
@keyframes dark { 0% { opacity: 0; } 15% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
@keyframes pulse { 0%, 100% { opacity: 0; } 25% { opacity: 1; } 50% { opacity: 0.15; } 75% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  #story.fx-shake, #story.fx-flash::after, #story.fx-dark::after, #story.fx-pulse::after, #story .roll.rolling .die { animation: none; }
  #story .roll.rolling .band { visibility: visible; }
}
`;

// Plain ES2017 that runs in the exported page; it must not depend on anything from this module.
const PLAYER = `(function () {
  var cfg = INKWRIGHT, langVar = cfg.languageVar;
  var json = document.getElementById("ink-story").textContent;
  var story = new inkjs.Story(json);
  var storyEl = document.getElementById("story"), choicesEl = document.getElementById("choices");
  var endEl = document.getElementById("end"), backEl = document.getElementById("back");
  var restartEl = document.getElementById("restart"), langEl = document.getElementById("language");
  var KEY = "inkwright:" + cfg.id, LANG_KEY = "inkwright-language:" + cfg.id;
  var log = [];      // [{ text, kind }]; kind: "text" | "chosen" | "error"
  var shown = 0;     // log entries rendered last time: the first new one is scrolled into view
  var still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // #fx:<name> tags on a line, from the fixed list.
  function fxOf(tags) {
    return (tags || []).map(function (t) {
      var p = t.split(":").map(function (x) { return x.trim(); });
      return p.length === 2 && p[0] === "fx" && cfg.fx.indexOf(p[1]) >= 0 ? p[1] : null;
    }).filter(Boolean);
  }
  var afterChoice = false; // a choice was clicked: the next text that arrives is scrolled to
  var history = [];  // [{ state, n }]: state before each choice, log length then
  var start = null;  // state at the beginning, to replay picks in another language
  var picks = [];    // choices since start: an index, or { index, payload } for one taken with a card
  var picked = null; // { hand, card }: the card tapped in a hand, for the next #play choice
  var replaying = false;
  var halted = false;  // the last step was stopped (loop or error); its state is not saved
  story.onError = function (msg) { log.push({ text: msg, kind: "error" }); };
  // Game mode: the engine (window.InkwrightGame) referees checks and reads the HUD from the story's state.
  var G = cfg.game && window.InkwrightGame ? window.InkwrightGame : null;
  var engine = G ? new G.GameEngine(cfg.game) : null;
  var playable = cfg.game ? cfg.game.characters.filter(function (c) { return c.playable !== false; }) : [];
  var hudEl = document.getElementById("hud"), diceEl = document.getElementById("dice"), handsEl = document.getElementById("hands"), mapEl = document.getElementById("map");
  var charEl = document.getElementById("character"), CHAR_KEY = "inkwright-character:" + cfg.id;
  if (engine) engine.setup(story, storage(true, CHAR_KEY) || undefined);

  function storage(get, value) {
    try {
      if (get) return localStorage.getItem(value);
      localStorage.setItem(value[0], value[1]);
    } catch (e) { /* storage full or blocked: play on without saving */ }
    return null;
  }

  function language() { return langVar ? String(story.variablesState[langVar]) : null; }
  function str() { return cfg.strings[language() || cfg.ui] || cfg.strings[cfg.ui]; }

  function skillOf(id) {
    var lang = language() || cfg.ui, found = null;
    cfg.game.skills.forEach(function (k) { if (k.id === id) found = k; });
    return { name: found ? G.localize(found.name, lang, id) : id, color: found && found.voice ? found.voice.color : null };
  }

  // The map: the image (or a plain board), lines between linked places, the places (a question mark until revealed,
  // a ring where the player stands, pulsing when a choice goes there; tapping one takes that choice), counters and tokens.
  function renderMap() {
    var choices = story.currentChoices.map(function (c) { return { index: c.index, tags: c.tags || [] }; });
    var m = engine ? engine.map(choices) : null;
    mapEl.textContent = "";
    mapEl.hidden = !m;
    if (!m) return;
    mapEl.style.aspectRatio = m.width + " / " + m.height;
    if (cfg.mapImage) {
      var img = document.createElement("img");
      img.src = cfg.mapImage;
      img.alt = "";
      mapEl.appendChild(img);
    }
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + m.width + " " + m.height);
    svg.setAttribute("preserveAspectRatio", "none");
    var byId = {}, drawn = {};
    m.places.forEach(function (p) { byId[p.id] = p; });
    m.places.forEach(function (p) {
      p.links.forEach(function (l) {
        var q = byId[l], key = [p.id, l].sort().join("|");
        if (!q || drawn[key]) return;
        drawn[key] = true;
        var line = document.createElementNS(NS, "line");
        line.setAttribute("x1", p.x); line.setAttribute("y1", p.y); line.setAttribute("x2", q.x); line.setAttribute("y2", q.y);
        if (!p.revealed || !q.revealed) line.setAttribute("class", "dim");
        svg.appendChild(line);
      });
    });
    mapEl.appendChild(svg);
    var pct = function (v, of) { return (v / of * 100) + "%"; };
    m.places.forEach(function (p) {
      var goes = p.go !== undefined, el = document.createElement(goes ? "button" : "div"), n = document.createElement("span");
      el.className = "place" + (p.revealed ? "" : " unknown") + (p.here ? " here" : "") + (goes ? " go" : "");
      if (goes) el.type = "button";
      el.style.left = pct(p.x, m.width);
      el.style.top = pct(p.y, m.height);
      n.textContent = p.revealed ? p.name : "?";
      el.appendChild(n);
      if (p.revealed && p.counter) {
        var c = document.createElement("span");
        c.className = "counter";
        c.textContent = p.counter.value;
        c.title = p.counter.name;
        el.appendChild(c);
      }
      if (goes) {
        var choice = story.currentChoices.filter(function (c) { return c.index === p.go; })[0];
        el.onclick = function () { choose(p.go, choice ? choice.text : p.name, null); };
      }
      mapEl.appendChild(el);
    });
    var stacks = {};
    m.tokens.forEach(function (t) {
      var p = t.at ? byId[t.at] : null;
      if (!p) return;
      var k = stacks[p.id] || 0, tok = document.createElement("span");
      stacks[p.id] = k + 1;
      tok.className = "token";
      tok.textContent = Array.from(t.name)[0] || "";
      tok.title = t.name;
      if (t.color) tok.style.background = t.color;
      tok.style.left = "calc(" + pct(p.x, m.width) + " + " + (k * 14) + "px)";
      tok.style.top = "calc(" + pct(p.y, m.height) + " - 22px)";
      mapEl.appendChild(tok);
    });
  }

  // Each hand as a row of cards: tap one to pick it (its description shows under the row), tap again to put it back.
  function renderHands() {
    var hands = engine ? engine.hud().hands : null;
    handsEl.textContent = "";
    handsEl.hidden = !hands;
    if (!hands) return;
    hands.forEach(function (hand) {
      var box = document.createElement("div"), name = document.createElement("div");
      box.className = "hand";
      name.className = "name";
      name.textContent = hand.name + (hand.cards.length ? "" : " · " + str().nothingCarried);
      box.appendChild(name);
      var on = picked && picked.hand === hand.id ? hand.cards.filter(function (c) { return c.id === picked.card; })[0] : null;
      if (hand.cards.length) {
        var row = document.createElement("div");
        row.className = "cards";
        hand.cards.forEach(function (card) {
          var b = document.createElement("button"), d = document.createElement("span"), n = document.createElement("span");
          var art = card.image !== undefined ? cfg.cardImages[card.id] : null;
          b.type = "button";
          b.className = "card" + (on && on.id === card.id ? " on" : "") + (art ? " illustrated" : "");
          b.setAttribute("aria-pressed", on && on.id === card.id ? "true" : "false");
          if (art) {
            var img = document.createElement("img");
            img.src = art;
            img.alt = "";
            b.appendChild(img);
          }
          d.className = "deck";
          d.textContent = card.deckName;
          n.className = "cardname";
          n.textContent = card.name;
          b.appendChild(d);
          b.appendChild(n);
          if (card.attrs && card.attrs.length) {
            var attrs = document.createElement("div");
            attrs.className = "attrs";
            card.attrs.forEach(function (a) {
              var span = document.createElement("span");
              span.className = "attr";
              span.textContent = a.name + " " + a.value;
              span.title = a.name;
              attrs.appendChild(span);
            });
            b.appendChild(attrs);
          }
          b.onclick = function () {
            picked = on && on.id === card.id ? null : { hand: hand.id, card: card.id };
            // Re-render in place; the rows keep their scroll position.
            var scrolls = Array.prototype.map.call(handsEl.querySelectorAll(".cards"), function (r) { return r.scrollLeft; });
            render();
            Array.prototype.forEach.call(handsEl.querySelectorAll(".cards"), function (r, i) { r.scrollLeft = scrolls[i] || 0; });
          };
          row.appendChild(b);
        });
        box.appendChild(row);
      }
      if (on) {
        var p = document.createElement("p");
        p.className = "desc";
        p.textContent = on.desc ? on.name + ": " + on.desc : on.name;
        box.appendChild(p);
      }
      handsEl.appendChild(box);
    });
  }

  function renderHud() {
    var s = str(), h = engine.hud();
    function line(name, text) {
      var d = document.createElement("div"), n = document.createElement("span");
      n.className = "name";
      n.textContent = name;
      d.appendChild(n);
      d.appendChild(document.createTextNode(text));
      hudEl.appendChild(d);
    }
    hudEl.textContent = "";
    hudEl.hidden = false;
    if (h.character) line(h.character.name, h.character.skills.map(function (k) { return k.name + " " + k.level; }).join(" · "));
    if (h.resources.length) line(s.status, h.resources.map(function (r) { return r.name + " " + r.value + "/" + r.max; }).join(" · "));
    if (h.items) line(s.inventory, h.items.length ? h.items.map(function (i) { return i.name; }).join(" · ") : s.nothingCarried);
    if (h.decks) line(s.decks, h.decks.map(function (d) { return d.name + " " + d.left + "/" + d.total; }).join(" · "));
    h.companions.forEach(function (c) {
      if (c.resources.length) line(c.name, c.resources.map(function (r) { return r.name + " " + r.value; }).join(" · "));
    });
  }

  function renderDice() {
    var s = str(), rolls = engine.rolls, ul = diceEl.querySelector("ul");
    diceEl.hidden = false;
    diceEl.querySelector("summary").textContent = s.diceLog + " (" + rolls.length + ")";
    ul.textContent = "";
    rolls.slice().reverse().forEach(function (r) {
      var li = document.createElement("li"), faces = r.rolls.length ? r.rolls.join("+") : "—";
      if (r.kind === "dice") {
        var got = r.deck ? r.deck.card : r.table ? r.table.text : null;
        li.textContent = (r.deck ? r.deck.name : r.table ? r.table.name + " " + r.formula : r.formula) + ": " + (r.unknown ? "?" : faces + " = " + r.total + (got !== null ? " · " + got : ""));
      } else {
        var mods = r.modifiers.map(function (m) { return (m.value > 0 ? " +" : " ") + m.value; }).join("");
        li.textContent = (r.unknown ? r.skill + " " + s.unknownSkill : skillOf(r.skill).name) + " " + r.difficulty + ": " +
          faces + " +" + r.level + mods + " = " + r.total + " · " + s.bands[r.band] + " (" + Math.round(r.chance.success * 100) + "%)";
      }
      ul.appendChild(li);
    });
  }

  function applyLanguage() {
    var pref = langVar && storage(true, LANG_KEY);
    if (pref) story.variablesState[langVar] = pref;
  }

  function labels() {
    var lang = language() || cfg.ui, s = cfg.strings[lang] || cfg.strings[cfg.ui];
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
    backEl.textContent = s.back;
    restartEl.textContent = s.restart;
    endEl.textContent = s.ended;
    langEl.title = s.language;
    langEl.setAttribute("aria-label", s.language);
    if (engine) {
      charEl.title = s.character;
      charEl.setAttribute("aria-label", s.character);
      charEl.textContent = "";
      playable.forEach(function (c) {
        var o = document.createElement("option");
        o.value = c.id;
        o.textContent = G.localize(c.name, lang, c.id);
        charEl.appendChild(o);
      });
      charEl.value = engine.character() || playable[0].id;
    }
  }

  function render() {
    labels();
    if (engine) {
      engine.language = language() || cfg.ui;
      renderHud();
      renderDice();
    }
    storyEl.textContent = "";
    var fresh = log.length > shown && afterChoice, newCards = [], fx = [], firstNew = null;
    var byTurn = {};
    if (engine) engine.rolls.forEach(function (r) { (byTurn[r.turn] = byTurn[r.turn] || []).push(r); });
    log.forEach(function (e, i) {
      var p = document.createElement("p");
      if (e.kind !== "text") p.className = e.kind;
      if (e.voice && engine) {
        var skill = skillOf(e.voice), who = document.createElement("span");
        p.className = "voice";
        if (skill.color) p.style.setProperty("--voice", skill.color);
        who.className = "who";
        who.textContent = skill.name;
        p.appendChild(who);
        p.appendChild(document.createTextNode(e.text));
      } else {
        p.textContent = e.text;
      }
      storyEl.appendChild(p);
      if (i === shown) firstNew = p;
      // A roll shows as a card under the choice that made it.
      if (e.kind === "chosen" && byTurn[e.turn]) {
        byTurn[e.turn].forEach(function (r) {
          var card = rollCard(r);
          storyEl.appendChild(card);
          if (fresh && i >= shown) newCards.push(card);
        });
      }
      if (fresh && i >= shown && e.fx) fx = fx.concat(e.fx);
    });
    renderMap();
    renderHands();
    choicesEl.textContent = "";
    story.currentChoices.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      // A #play choice is taken with the card picked in its hand; until then it waits, and with no card to play it is locked.
      var play = engine ? engine.playOf({ tags: c.tags || [] }) : null;
      var card = play && picked && picked.hand === play.hand ? play.cards.filter(function (k) { return k.id === picked.card; })[0] : null;
      var label = card ? c.text + " · " + card.name : c.text;
      b.textContent = label;
      var check = engine ? engine.describeChoice({ tags: c.tags || [] }) : null;
      if (check) {
        var span = document.createElement("span");
        span.className = "check";
        span.textContent = skillOf(check.skill).name + " " + check.difficulty + " · " + Math.round(check.chance.success * 100) + "%" +
          (check.red ? " · " + str().redCheck : "");
        b.appendChild(span);
      }
      // A choice that needs an item not carried is shown locked.
      var needs = engine ? engine.needsOf({ tags: c.tags || [] }) : [];
      needs.forEach(function (n) {
        var need = document.createElement("span");
        need.className = "need" + (n.has ? "" : " missing");
        need.textContent = str().needs + " " + n.name;
        b.appendChild(need);
      });
      if (play && !card) {
        var wait = document.createElement("span");
        wait.className = "need";
        wait.textContent = play.known && play.cards.length ? str().pickCard : play.name + " · " + str().nothingCarried;
        b.appendChild(wait);
      }
      if (needs.some(function (n) { return !n.has; }) || (play && !card)) b.disabled = true;
      b.onclick = function () { choose(c.index, label, card ? engine.playPayload(play.hand, card.id) : null); };
      choicesEl.appendChild(b);
    });
    endEl.hidden = halted || story.currentChoices.length > 0;
    backEl.disabled = history.length === 0;
    if (langVar) langEl.value = language();
    // After a choice, the first new paragraph goes to the top so the reader scrolls down from
    // there, new dice tumble and the new lines' effects play; when the text changed for another
    // reason (back, restart, resume), the choices are shown.
    if (fresh && firstNew) {
      firstNew.scrollIntoView({ block: "start" });
      animateRolls(newCards);
      playFx(fx);
    } else if (log.length !== shown) {
      choicesEl.scrollIntoView({ block: "end" });
    }
    afterChoice = false;  // a choice renders exactly once (advance is synchronous)
    shown = log.length;
  }

  function faces(rolls) {
    var dice = document.createElement("span");
    rolls.forEach(function (face) {
      var die = document.createElement("span");
      die.className = "die";
      die.textContent = face;
      dice.appendChild(die);
    });
    return dice;
  }

  function rollCard(r) {
    var s = str(), card = document.createElement("div");
    var skill = document.createElement("span");
    skill.className = "skill";
    if (r.kind === "dice") {
      // Free dice, a table or a deck: the formula (or the table and its dice, or the deck), the faces, the total, the row or card.
      card.className = "roll free";
      skill.textContent = r.deck ? r.deck.name : r.table ? r.table.name + " " + r.formula : r.formula;
      card.appendChild(skill);
      card.appendChild(faces(r.rolls));
      var total = document.createElement("span");
      total.textContent = r.unknown ? "?" : "= " + r.total;
      card.appendChild(total);
      var result = r.deck ? r.deck.card : r.table ? r.table.text : null;
      if (result !== null) {
        var row = document.createElement("span");
        row.className = "band";
        row.textContent = result;
        if (r.deck && r.deck.desc) row.title = r.deck.desc;
        card.appendChild(row);
      }
      return card;
    }
    card.className = "roll b" + r.band;
    skill.textContent = (r.unknown ? r.skill + " " + s.unknownSkill : skillOf(r.skill).name) + " " + r.difficulty;
    card.appendChild(skill);
    card.appendChild(faces(r.rolls));
    var sum = document.createElement("span");
    var mods = r.modifiers.map(function (m) { return (m.value > 0 ? " +" : " ") + m.value; }).join("");
    sum.textContent = "+" + r.level + mods + " = " + r.total;
    card.appendChild(sum);
    var band = document.createElement("span");
    band.className = "band";
    band.textContent = s.bands[r.band];
    card.appendChild(band);
    return card;
  }

  // The faces of new cards tumble for a moment before settling; the outcome shows once they have.
  function animateRolls(cards) {
    if (still) return;
    cards.forEach(function (card) {
      var dice = Array.prototype.slice.call(card.querySelectorAll(".die"));
      var faces = dice.map(function (d) { return d.textContent; });
      card.classList.add("rolling");
      var ticks = 0;
      var timer = setInterval(function () {
        if (++ticks > 8) {
          clearInterval(timer);
          dice.forEach(function (d, i) { d.textContent = faces[i]; });
          card.classList.remove("rolling");
          return;
        }
        dice.forEach(function (d) { d.textContent = String(1 + Math.floor(Math.random() * 6)); });
      }, 70);
    });
  }

  // Plays the effects of the new lines on the story, one after another.
  function playFx(effects) {
    if (still) return;
    effects.forEach(function (name, i) {
      var play = function () {
        var cls = "fx-" + name;
        var done = function () { storyEl.classList.remove(cls); };
        storyEl.classList.add(cls);
        storyEl.addEventListener("animationend", done, { once: true });
        setTimeout(done, 2500);
      };
      if (i === 0) play(); else setTimeout(play, i * 900);
    });
  }

  function fail(e) { log.push({ text: String(e && e.message || e), kind: "error" }); }

  // Time-sliced like the play panel, so a looping story is stopped instead of freezing the page.
  function advance() {
    var deadline = Date.now() + cfg.loopMs;
    halted = false;
    while (story.canContinue) {
      try {
        story.ContinueAsync(20);
      } catch (e) {
        fail(e);
        halted = true;
        break;
      }
      if (story.asyncContinueComplete) {
        var text = (story.currentText || "").replace(/\\n+$/, "");
        if (text !== "") {
          var entry = { text: text, kind: "text", turn: story.state.currentTurnIndex };
          var voice = engine ? engine.voiceOf({ tags: story.currentTags || [] }) : null;
          if (voice) entry.voice = voice;
          var effects = fxOf(story.currentTags);
          if (effects.length) entry.fx = effects;
          log.push(entry);
        }
      }
      if (Date.now() > deadline) {
        log.push({ text: (cfg.strings[language() || cfg.ui] || cfg.strings[cfg.ui]).loop, kind: "error" });
        halted = true;
        break;
      }
    }
    if (replaying) return;
    // A stopped step is mid-run: keep the last good save, so a reload resumes before it.
    if (!halted) persist();
    render();
  }

  // A payload writes a variable just before the choice runs: the card played (a list item by name) or text typed.
  function choose(index, text, payload) {
    if (!replaying) afterChoice = true;
    var before = story.state.ToJson();
    try {
      if (payload) story.variablesState[payload.var] = payload.item !== undefined ? inkjs.InkList.FromString(payload.item, story) : payload.text;
      story.ChooseChoiceIndex(index);
    } catch (e) {
      story.state.LoadJson(before);
      fail(e);
      if (!replaying) render();
      return;
    }
    history.push({ state: before, n: log.length });
    picks.push(payload ? { index: index, payload: payload } : index);
    picked = null;
    log.push({ text: text, kind: "chosen", turn: story.state.currentTurnIndex });
    advance();
  }

  function begin() {
    story.ResetState();
    applyLanguage();
    if (engine) engine.start(story, storage(true, CHAR_KEY) || undefined);
    start = story.state.ToJson();
    log = [];
    history = [];
    picks = [];
    advance();
  }

  // Replays the run from the start, so earlier text and the current choices use the new language.
  function replay() {
    if (!start) {  // progress saved before start was kept: only new text changes
      applyLanguage();
      persist();
      render();
      return;
    }
    var old = picks;
    story.state.LoadJson(start);
    applyLanguage();
    if (engine) engine.language = language() || cfg.ui;  // the replayed choices name their cards in the new language
    start = story.state.ToJson();
    log = [];
    history = [];
    picks = [];
    replaying = true;
    advance();
    old.forEach(function (p) {
      var i = typeof p === "number" ? p : p.index, payload = typeof p === "number" ? null : p.payload;
      var c = story.currentChoices.filter(function (c) { return c.index === i; })[0];
      if (c) choose(i, payload && payload.item !== undefined && engine ? c.text + " · " + engine.cardName(payload.item) : c.text, payload);
    });
    replaying = false;
    if (!halted) persist();
    render();
  }

  function persist() {
    storage(false, [KEY, JSON.stringify({ version: cfg.version, state: story.state.ToJson(), log: log,
      history: history.slice(-50), start: start, picks: picks })]);
  }

  function resume() {
    try {
      var saved = JSON.parse(storage(true, KEY) || "null");
      // Progress from an earlier export of the story may not fit this one.
      if (!saved || saved.version !== cfg.version) return false;
      story.state.LoadJson(saved.state);
      log = saved.log;
      history = saved.history;
      start = saved.start;
      picks = saved.picks;
      return true;
    } catch (e) {
      return false;
    }
  }

  backEl.onclick = function () {
    var h = history.pop();
    if (!h) return;
    story.state.LoadJson(h.state);
    log.length = h.n;
    picks.pop();
    picked = null;
    halted = false;
    persist();
    render();
  };
  restartEl.onclick = function () {
    begin();
    window.scrollTo(0, 0);
  };
  if (engine && playable.length > 1) {
    charEl.hidden = false;
    charEl.onchange = function () {
      storage(false, [CHAR_KEY, charEl.value]);
      begin();
      window.scrollTo(0, 0);
    };
  }
  if (langVar) {
    cfg.languages.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.code;
      o.textContent = l.name;
      langEl.appendChild(o);
    });
    langEl.hidden = false;
    langEl.onchange = function () {
      storage(false, [LANG_KEY, langEl.value]);
      replay();
    };
  }

  if (resume()) render(); else begin();
})();`;
