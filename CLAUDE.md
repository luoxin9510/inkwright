# Inkwright (id: inkwright)

Obsidian plugin: edit and play ink stories (inkjs), Chinese/English UI, desktop + mobile.

## Commands
- `npm test` — vitest (Node). macOS has no `timeout`; wrap long runs with `perl -e 'alarm 90; exec @ARGV' npx vitest run`.
- `npm run check-ink -- <folder>` — compile + auto-play every main .ink under a folder (INCLUDEd chapters skipped); use it on vault content and tutorial examples. `--all` plays every branch (breadth-first, `src/play/explore.ts`) and lists the endings; `--lang zh|en` for bilingual stories. A story with a `game.md` next to it is explored in game mode, once per character, walking success and failure of every check (paths show `[insight✗]`); failed checks that change nothing are warnings. States reached before are not expanded again (`stateKey` in explore.ts; turn counters, seed and last random are left out, so futures that differ only by a RANDOM still to come count as one) and a spot (the same choices offered) is expanded from at most `--states-per-spot N` states (default 10), so a game whose resources differ on every path stays finite; `--max-steps N` (default 20000) still bounds the walk.
- `npm run export-web -- <main.ink> <out.html> [--lang zh|en] [--id key]` — the web export from the command line (used by the public games repo luoxin9510/ink-games). A `game.md` next to the story makes the page a game (engine embedded).
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

## Game mode
PRD: `docs/game-engine-prd.md` — TTRPG-style rules engine on top of Inkwright (2d6 checks on choice tags, 5 skills as inner voices, fear resource, 4 selectable PCs, state stays in ink). Read it before touching `src/game/`. Example game: vault `试玩沙盒/游戏模式/` (`游戏.md` + `_引擎.ink` + `main.ink`).
- A game is a folder whose main story sits next to a `game.md` (or `游戏.md`) note; its frontmatter is the `GameConfig` (`src/game/obsidian.ts`: `findGameNote`, `loadGameConfig` via the metadata cache → `readConfig` in config.ts checks the shape, then `validateConfig` the rules). Problems are data (`ConfigProblem` = code + args) worded by `T().configProblem`, shown as warning diagnostics; the note is a dependency, so edits reload (also on `metadataCache` "changed").
- `src/game/dice.ts` — dice systems (`sum` = NdX + skill vs difficulty with natural crits and a partial band; `rollUnder` = d100 CoC style), `resolve` (rng injectable, `force` a band for explorers), `chance` by enumeration. Five bands 0–4 shared by every system.
- `src/game/config.ts` — `GameConfig` (rules, skills, resources, companion resources, characters, modifier rules, ink names), check/voice tag parsing (`* [text #check:skill:difficulty[:red]]`, difficulty optional for `rollUnder`; `#voice:skill`), `collectModifiers` from story state, `validateConfig`. Ids are code (English); player-facing names are `LocalizedText` (`{ zh, en }`, `localize`). Ink name presets: `ink: en` (default) / `ink: zh`; `languages: [zh, en]` makes the generated ink declare the `lang` VAR and `t(zh, en)`. A character with `playable: false` is a companion only (`playableCharacters`): never in the picker (no picker when one character is playable), not played by `check-ink --all`, but it still gets companion variables.
- `src/game/inkgen.ts` — `generateInk(config)` → the `_engine.ink` a game INCLUDEs: VARs, character LIST, `pick_character(who)` preset loader, `skill_level(name)`, `t()` for bilingual games, and an ink fallback for the EXTERNAL check so stories run without the engine. Stories call `check("skill", difficulty)` with the id as a string (the engine logs the roll under that skill).
- `src/game/engine.ts` — `GameEngine`: binds the EXTERNAL check on each new Story (`PlaySession`'s `setup` hook), loads the character preset, `describeChoice`/`voiceOf`/`hud()`, keeps the dice log. The story's variables are the only state: the engine writes only the preset, a per-run dice seed and a roll counter, and the n-th check's faces are a hash of (seed, n), so back/load/language replay roll the same dice (`seededDice` in dice.ts).
- `src/views/PlayView.ts` renders the character picker, HUD, check odds on choice buttons, voice paragraphs and the dice log; `api.panel().game` and `api.character(id)` expose the same.
- Engine code must stay game-agnostic: skills, resources, characters and names come from the config, never from literals in `src/`.
- Command `inkwright:generate-engine` / `api.generateEngine(path?)` writes the engine file (`engineFile`, default `_engine.ink`) from the note; the panel warns when the story lacks the INCLUDE or the file no longer matches the note.
- Keep ids and ink names English and localize only player-facing text; no separate translation tables.
- `exploreStory(story, { game, character, bands })` forces every check through the engine's `force` hook: success first, then a sibling move per other band, so both sides of each check are played (a check met before the first choice is played as success only); `checks.noConsequence` lists failed checks after which no variable and no choice changed (text-only or visit-count-only changes do not count). `api.explore` picks the game config up automatically; `check-ink --all` parses the note with `yaml` (CLI only).
- Web export (M4): `buildWebPage({ game, engine })` embeds the config and the engine bundle (`virtual:game-engine` = `scripts/engine-bundle.mjs` building `src/game/browser.ts` into the global `InkwrightGame`; same plugin in esbuild.config.mjs and vitest.config.ts, and export-web builds it at run time). The page's player then has a character picker, HUD, check odds on choices, voice paragraphs and a dice log; `engine.start(story, character)` re-seeds after `ResetState`. `pick_character` takes the id as a string, so the engine needs no inkjs import.
- Next: the first slice script (M3).

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
- CI (`.github/workflows/ci.yml`): test + lint + check-release on every push/PR; `main` is protected, so changes go through a PR and the `check` job must pass before merging. `claude-review.yml`: independent Claude review, only on the owner's own non-fork PRs (secret is the owner's token).
- Release cadence: batch merged PRs and release about once a week, not after every PR.
- Release: bump `manifest.json`, `package.json`, `versions.json`; tag equals version without `v`; pushing the tag runs `release.yml`, which builds and creates a draft GitHub release with main.js, manifest.json, styles.css; publish the draft by hand.
