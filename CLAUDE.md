# Inkwright (id: inkwright)

Obsidian plugin: edit and play ink stories (inkjs), Chinese/English UI, desktop + mobile.

## Commands
- `npm test` — vitest (Node). macOS has no `timeout`; wrap long runs with `perl -e 'alarm 90; exec @ARGV' npx vitest run`.
- `npm run check-ink -- <folder>` — compile + auto-play every main .ink under a folder (INCLUDEd chapters skipped); use it on vault content and tutorial examples.
- `npm run build` — tsc + esbuild → `main.js`. `OBSIDIAN_PLUGIN_DIR=<vault>/.obsidian/plugins/inkwright npm run build` builds into a vault.
- Game vault: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/ink-games` (iCloud, used on phone too).

## Verify in Obsidian (Obsidian CLI, `/opt/homebrew/bin/obsidian`)
Always pass `vault=ink-games`. Never quit/restart the whole app: other sessions may be using other vaults (e.g. atlas-vtt).
- Deploy + reload: build with `OBSIDIAN_PLUGIN_DIR` (above), then `obsidian vault=ink-games plugin:reload id=inkwright`.
- Drive it: `open path="游戏/雨夜来客/main.ink"`, `command id=inkwright:open-play` (also `inkwright:lock-main`, `inkwright:unlock-main`); `commands` lists ids.
- Inspect: `dev:errors` (captured errors), `dev:console`, `dev:screenshot path=<png>` (2940x1696; crop with `sips -c H W --cropOffset Y X`), `dev:dom`, `eval code='...'` (e.g. `app.plugins.plugins.inkwright`), `dev:mobile` (toggle mobile emulation).
- `reload` reloads only the vault; `plugins:enabled`, `plugin id=inkwright` show state.

## Agent API (`src/api.ts`)
`app.plugins.plugins.inkwright.api` — call via `obsidian vault=ink-games eval code='...api.<method>(...).then(JSON.stringify)'`; `api.help()` prints usage.
Headless: `compile(path)`, `graph(path)` (nodes/edges/unreachable), `play(path, {from?, choices?})` (choices by index or text) → transcript, variables, visits, errors. Visible panel: `open`, `panel`, `choose`, `restart`, `startAt`.
The game vault has its own `CLAUDE.md` telling agents how to playtest; keep it in sync when the API changes.

## Layout
- `src/compile/` pure logic: `paths` (INCLUDE scan/resolve, relative to the main story's folder), `include` (async preload → sync `CachedFileHandler`), `diagnostics` (parse `ERROR: 'file' line N: msg`, translate), `zh.ts` (zh table; each regex matches a real inkjs message), `compile.ts`.
- `src/play/session.ts` — `PlaySession`: time-sliced `ContinueAsync` loop guard, restart rebuilds Story from JSON, per-step translated errors, EXTERNAL fallbacks on.
- `src/compile/graph.ts` — divert graph from the parsed tree (duck-typed by `typeName`; minified class names). `src/graph/layout.ts` — layered layout. `src/views/GraphView.ts` — SVG view, pan/pinch zoom, node popover (open source / play from here).
- `src/play/script.ts` — `playScript` (scripted play for the API; `pick` matches choices by index/text).
- `src/play/inspect.ts` — variable panel data: names from `variablesState._globalVariables` (state JSON omits defaults), values via `variablesState[name]`, visit counts from state JSON (compile uses countAllVisits; compiler-generated path segments hidden).
- `src/root.ts` — main-story lock rules, `LatestOnly`. `src/i18n.ts` — `T()` zh/en tables, language from `moment.locale()`.
- `src/views/` + `src/main.ts` — Obsidian wiring incl. settings tab (language: auto/zh/en). No unit tests; verify with the Obsidian CLI.

## Rules
- No Node/Electron APIs in `src/` (mobile). File IO only via Vault API.
- Any user-visible text goes through `T()` with both zh and en; tests enforce every en string differs from zh.
- New zh error entries: get the exact inkjs text by compiling a broken story first, then add a test with that text.
- Pure logic: write the failing test first. UI wiring: build, reload, then check `dev:errors` + a screenshot yourself before asking the user.
- Release: bump `manifest.json`, `package.json`, `versions.json`; tag equals version without `v`; attach main.js, manifest.json, styles.css.
