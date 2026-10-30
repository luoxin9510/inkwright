import type { GameConfig } from "../game/config";
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
    languages: STORY_LANGUAGES,
    loopMs: LOOP_SECONDS * 1000,
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
<div id="story"></div>
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
#dice { font-size: 0.8em; color: var(--muted); margin-top: 1.2em; }
#dice summary { cursor: pointer; }
#dice ul { margin: 0.4em 0 0; padding-left: 1.2em; }
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
  var afterChoice = false; // a choice was clicked: the next text that arrives is scrolled to
  var history = [];  // [{ state, n }]: state before each choice, log length then
  var start = null;  // state at the beginning, to replay picks in another language
  var picks = [];    // choice indexes since start
  var replaying = false;
  var halted = false;  // the last step was stopped (loop or error); its state is not saved
  story.onError = function (msg) { log.push({ text: msg, kind: "error" }); };
  // Game mode: the engine (window.InkwrightGame) referees checks and reads the HUD from the story's state.
  var G = cfg.game && window.InkwrightGame ? window.InkwrightGame : null;
  var engine = G ? new G.GameEngine(cfg.game) : null;
  var playable = cfg.game ? cfg.game.characters.filter(function (c) { return c.playable !== false; }) : [];
  var hudEl = document.getElementById("hud"), diceEl = document.getElementById("dice");
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
      var li = document.createElement("li");
      var mods = r.modifiers.map(function (m) { return (m.value > 0 ? " +" : " ") + m.value; }).join("");
      li.textContent = (r.unknown ? r.skill + " " + s.unknownSkill : skillOf(r.skill).name) + " " + r.difficulty + ": " +
        (r.rolls.length ? r.rolls.join("+") : "—") + " +" + r.level + mods + " = " + r.total +
        " · " + s.bands[r.band] + " (" + Math.round(r.chance.success * 100) + "%)";
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
    log.forEach(function (e) {
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
    });
    choicesEl.textContent = "";
    story.currentChoices.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c.text;
      var check = engine ? engine.describeChoice({ tags: c.tags || [] }) : null;
      if (check) {
        var span = document.createElement("span");
        span.className = "check";
        span.textContent = skillOf(check.skill).name + " " + check.difficulty + " · " + Math.round(check.chance.success * 100) + "%" +
          (check.red ? " · " + str().redCheck : "");
        b.appendChild(span);
      }
      b.onclick = function () { choose(c.index, c.text); };
      choicesEl.appendChild(b);
    });
    endEl.hidden = halted || story.currentChoices.length > 0;
    backEl.disabled = history.length === 0;
    if (langVar) langEl.value = language();
    // After a choice, the first new paragraph goes to the top so the reader scrolls down from
    // there; when the text changed for another reason (back, restart, resume), the choices are shown.
    if (log.length > shown && afterChoice && storyEl.children[shown]) storyEl.children[shown].scrollIntoView({ block: "start" });
    else if (log.length !== shown) choicesEl.scrollIntoView({ block: "end" });
    afterChoice = false;  // a choice renders exactly once (advance is synchronous)
    shown = log.length;
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
          var voice = engine ? engine.voiceOf({ tags: story.currentTags || [] }) : null;
          log.push(voice ? { text: text, kind: "text", voice: voice } : { text: text, kind: "text" });
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

  function choose(index, text) {
    if (!replaying) afterChoice = true;
    var before = story.state.ToJson();
    try {
      story.ChooseChoiceIndex(index);
    } catch (e) {
      fail(e);
      if (!replaying) render();
      return;
    }
    history.push({ state: before, n: log.length });
    picks.push(index);
    log.push({ text: text, kind: "chosen" });
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
    start = story.state.ToJson();
    log = [];
    history = [];
    picks = [];
    replaying = true;
    advance();
    old.forEach(function (i) {
      var c = story.currentChoices.filter(function (c) { return c.index === i; })[0];
      if (c) choose(i, c.text);
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
