# ink-cn

Obsidian plugin: edit and play ink stories (inkjs), Chinese/English UI, desktop + mobile.

## Commands
- `npm test` — vitest (Node). macOS has no `timeout`; wrap long runs with `perl -e 'alarm 90; exec @ARGV' npx vitest run`.
- `npm run build` — tsc + esbuild → `main.js`. `OBSIDIAN_PLUGIN_DIR=<vault>/.obsidian/plugins/ink-cn npm run build` builds into a vault.
- Game vault: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/ink-games` (iCloud, used on phone too).

## Layout
- `src/compile/` pure logic: `paths` (INCLUDE scan/resolve, relative to the main story's folder), `include` (async preload → sync `CachedFileHandler`), `diagnostics` (parse `ERROR: 'file' line N: msg`, translate), `zh.ts` (zh table; each regex matches a real inkjs message), `compile.ts`.
- `src/play/session.ts` — `PlaySession`: time-sliced `ContinueAsync` loop guard, restart rebuilds Story from JSON, per-step translated errors, EXTERNAL fallbacks on.
- `src/root.ts` — main-story lock rules, `LatestOnly`. `src/i18n.ts` — `T()` zh/en tables, language from `moment.locale()`.
- `src/views/` + `src/main.ts` — Obsidian wiring (no unit tests; verify in Obsidian).

## Rules
- No Node/Electron APIs in `src/` (mobile). File IO only via Vault API.
- Any user-visible text goes through `T()` with both zh and en; tests enforce every en string differs from zh.
- New zh error entries: get the exact inkjs text by compiling a broken story first, then add a test with that text.
- Pure logic: write the failing test first. UI wiring: build, then ask the user to check in Obsidian.
- Release: bump `manifest.json`, `package.json`, `versions.json`; tag equals version without `v`; attach main.js, manifest.json, styles.css.
