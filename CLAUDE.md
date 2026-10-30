# Inkwright (id: inkwright)

Obsidian plugin: edit and play ink stories (inkjs), Chinese/English UI, desktop + mobile.

## Commands
- `npm test` — vitest (Node). macOS has no `timeout`; wrap long runs with `perl -e 'alarm 90; exec @ARGV' npx vitest run`.
- `npm run check-ink -- <folder>` — compile + auto-play every main .ink under a folder (INCLUDEd chapters skipped); use it on vault content and tutorial examples. `--all` plays every branch (breadth-first, `src/play/explore.ts`) and lists the endings; `--lang zh|en` for bilingual stories.
- `npm run export-web -- <main.ink> <out.html> [--lang zh|en] [--id key]` — the web export from the command line (used by the public games repo luoxin9510/ink-games).
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
Headless: `compile(path)`, `graph(path)` (nodes/edges/unreachable), `play(path, {from?, choices?})` (choices by index or text) → transcript, variables, visits, errors; `explore(path, {language?})` → every ending reached and runtime errors. Visible panel: `open`, `panel`, `choose`, `restart`, `startAt`, `back`, `save`, `saves`, `load`, `deleteSave` (saves live in plugin data per main story). Export: `exportWeb(path?)` → standalone `.html` next to the story. Bilingual stories (`VAR 语言`/`VAR lang`, text via `{双("中文", "English")}`): `play(path, {language})`, panel `language(lang)`; switching replays the run (`PlaySession.setLanguage`), `src/compile/bilingual.ts` warns about bare text.
The game vault has its own `CLAUDE.md` telling agents how to playtest; keep it in sync when the API changes.

## Game mode (planned)
PRD: `docs/game-engine-prd.md` — TTRPG-style rules engine on top of Inkwright (2d6 checks on choice tags, 5 skills as inner voices, fear resource, 4 selectable PCs, state stays in ink). Read it before touching `src/game/`.
- `src/game/dice.ts` — dice systems (`sum` = NdX + skill vs difficulty with natural crits and a partial band; `rollUnder` = d100 CoC style), `resolve` (rng injectable, `force` a band for explorers), `chance` by enumeration. Five bands 0–4 shared by every system.
- `src/game/config.ts` — `GameConfig` (rules, skills, resources, companion resources, characters, modifier rules, ink names), check/voice tag parsing, `collectModifiers` from story state, `validateConfig`.
- `src/game/inkgen.ts` — `generateInk(config)` → the `_引擎.ink` a game INCLUDEs: VARs, character LIST, `选主角(谁)` preset loader, and an ink fallback for the EXTERNAL check function so stories run without the engine.
- Engine code must stay game-agnostic: skills, resources, characters and names come from the config, never from literals in `src/`.

## Layout
- `src/compile/` pure logic: `paths` (INCLUDE scan/resolve, relative to the main story's folder), `include` (async preload → sync `CachedFileHandler`), `diagnostics` (parse `ERROR: 'file' line N: msg`, translate), `zh.ts` (zh table; each regex matches a real inkjs message), `compile.ts`.
- `src/play/session.ts` — `PlaySession`: time-sliced `ContinueAsync` loop guard, restart rebuilds Story from JSON, per-step translated errors, EXTERNAL fallbacks on.
- `src/compile/graph.ts` — divert graph from the parsed tree (duck-typed by `typeName`; minified class names). `src/graph/layout.ts` — layered layout. `src/views/GraphView.ts` — SVG view, pan/pinch zoom, node popover (open source / play from here).
- `src/export/web.ts` — standalone web page (inkjs runtime via `virtual:ink-runtime`, provided by plugins in `esbuild.config.mjs` and `vitest.config.ts`; player script is a plain-JS string, tested with happy-dom in `tests/web.test.ts`).
- `src/play/script.ts` — `playScript` (scripted play for the API; `pick` matches choices by index/text).
- `src/play/inspect.ts` — variable panel data: names from `variablesState._globalVariables` (state JSON omits defaults), values via `variablesState[name]`, visit counts from state JSON (compile uses countAllVisits; compiler-generated path segments hidden).
- `src/root.ts` — main-story lock rules, `LatestOnly`. `src/i18n.ts` — `T()` zh/en tables, language from `moment.locale()`.
- `src/views/` + `src/main.ts` — Obsidian wiring incl. settings tab (language: auto/zh/en). No unit tests; verify with the Obsidian CLI.

## Rules
- No Node/Electron APIs in `src/` (mobile). File IO only via Vault API.
- Any user-visible text goes through `T()` with both zh and en; tests enforce every en string differs from zh.
- New zh error entries: get the exact inkjs text by compiling a broken story first, then add a test with that text.
- Pure logic: write the failing test first. UI wiring: build, reload, then check `dev:errors` + a screenshot yourself before asking the user.
- `npm run lint` — the Obsidian community directory's checks: eslint-plugin-obsidianmd over `src/`, `package.json` (dependency replacements) and `manifest.json`, with `--max-warnings 0`, plus stylelint on `styles.css` (no `!important`). Must pass clean.
- `npm run check-release` — manifest/package/versions.json versions agree (and match the tag in CI); `npm run build` is reproducible (the directory rebuilds and compares main.js).
- CI (`.github/workflows/ci.yml`): test + lint + check-release on every push/PR; `main` is protected, so changes go through a PR and the `check` job must pass before merging. `claude-review.yml`: independent Claude review on each PR.
- Release cadence: batch merged PRs and release about once a week, not after every PR.
- Release: bump `manifest.json`, `package.json`, `versions.json`; tag equals version without `v`; pushing the tag runs `release.yml`, which builds and creates a draft GitHub release with main.js, manifest.json, styles.css; publish the draft by hand.
