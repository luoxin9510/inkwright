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
    return { restart: t.restart, back: t.back, ended: t.ended, language: t.storyLanguage };
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
<div id="story"></div>
<div id="choices"></div>
<p id="end" hidden></p>
<nav><button id="back" type="button"></button><button id="restart" type="button"></button><select id="language" hidden></select></nav>
</main>
<script type="application/json" id="ink-story">${story}</script>
<script>${scriptSafe(o.runtime)}</script>
<script>var INKWRIGHT = ${config};
${PLAYER}</script>
</body>
</html>
`;
}

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
  var history = [];  // [{ state, n }]: state before each choice, log length then
  var start = null;  // state at the beginning, to replay picks in another language
  var picks = [];    // choice indexes since start
  var replaying = false;
  story.onError = function (msg) { log.push({ text: msg, kind: "error" }); };

  function storage(get, value) {
    try {
      if (get) return localStorage.getItem(value);
      localStorage.setItem(value[0], value[1]);
    } catch (e) { /* storage full or blocked: play on without saving */ }
    return null;
  }

  function language() { return langVar ? String(story.variablesState[langVar]) : null; }

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
  }

  function render() {
    labels();
    storyEl.textContent = "";
    log.forEach(function (e) {
      var p = document.createElement("p");
      if (e.kind !== "text") p.className = e.kind;
      p.textContent = e.text;
      storyEl.appendChild(p);
    });
    choicesEl.textContent = "";
    story.currentChoices.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c.text;
      b.onclick = function () { choose(c.index, c.text); };
      choicesEl.appendChild(b);
    });
    endEl.hidden = story.currentChoices.length > 0;
    backEl.disabled = history.length === 0;
    if (langVar) langEl.value = language();
  }

  function advance() {
    while (story.canContinue) {
      var text = story.Continue().replace(/\\n+$/, "");
      if (text !== "") log.push({ text: text, kind: "text" });
    }
    if (replaying) return;
    persist();
    render();
  }

  function choose(index, text) {
    history.push({ state: story.state.ToJson(), n: log.length });
    story.ChooseChoiceIndex(index);
    picks.push(index);
    log.push({ text: text, kind: "chosen" });
    advance();
  }

  function begin() {
    story.ResetState();
    applyLanguage();
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
    persist();
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
    persist();
    render();
  };
  restartEl.onclick = function () {
    begin();
    window.scrollTo(0, 0);
  };
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
