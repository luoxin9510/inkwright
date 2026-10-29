import { T, getLanguage } from "../i18n";

export interface WebPageOptions {
  title: string;
  /** Compiled story JSON (story.ToJson()). */
  storyJson: string;
  /** inkjs runtime source (dist/ink.js). */
  runtime: string;
  /** Key for the player's progress in localStorage; use the main story path. */
  id: string;
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
  const t = T();
  const strings = { restart: t.restart, back: t.back, ended: t.ended };
  // "<" only occurs inside JSON strings, where < is equivalent.
  const story = o.storyJson.replace(/</g, "\\u003c");
  const config = JSON.stringify({ id: o.id, version: hash(o.storyJson), strings }).replace(/</g, "\\u003c");
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
<nav><button id="back" type="button"></button><button id="restart" type="button"></button></nav>
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
nav button:disabled { opacity: 0.4; cursor: default; }
`;

// Plain ES2017 that runs in the exported page; it must not depend on anything from this module.
const PLAYER = `(function () {
  var cfg = INKWRIGHT, s = cfg.strings;
  var json = document.getElementById("ink-story").textContent;
  var story = new inkjs.Story(json);
  var storyEl = document.getElementById("story"), choicesEl = document.getElementById("choices");
  var endEl = document.getElementById("end"), backEl = document.getElementById("back");
  var KEY = "inkwright:" + cfg.id;
  var log = [];      // [{ text, kind }]; kind: "text" | "chosen" | "error"
  var history = [];  // [{ state, n }]: state before each choice, log length then
  backEl.textContent = s.back;
  endEl.textContent = s.ended;
  document.getElementById("restart").textContent = s.restart;
  story.onError = function (msg) { log.push({ text: msg, kind: "error" }); };

  function render() {
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
  }

  function advance() {
    while (story.canContinue) {
      var text = story.Continue().replace(/\\n+$/, "");
      if (text !== "") log.push({ text: text, kind: "text" });
    }
    persist();
    render();
  }

  function choose(index, text) {
    history.push({ state: story.state.ToJson(), n: log.length });
    story.ChooseChoiceIndex(index);
    log.push({ text: text, kind: "chosen" });
    advance();
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: cfg.version, state: story.state.ToJson(), log: log, history: history.slice(-50) }));
    } catch (e) { /* storage full or blocked: play on without saving */ }
  }

  function resume() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      // Progress from an earlier export of the story may not fit this one.
      if (!saved || saved.version !== cfg.version) return false;
      story.state.LoadJson(saved.state);
      log = saved.log;
      history = saved.history;
      return true;
    } catch (e) {
      story.ResetState();
      log = [];
      history = [];
      return false;
    }
  }

  backEl.onclick = function () {
    var h = history.pop();
    if (!h) return;
    story.state.LoadJson(h.state);
    log.length = h.n;
    persist();
    render();
  };
  document.getElementById("restart").onclick = function () {
    story.ResetState();
    log = [];
    history = [];
    advance();
    window.scrollTo(0, 0);
  };

  if (resume()) render(); else advance();
})();`;
