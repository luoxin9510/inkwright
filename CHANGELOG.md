# Changelog

Release notes for each version; the GitHub release carries the same text and the built plugin.

## 0.4.0 — 2026-10-31

Game mode, from the first rules to a playable night. Requires Obsidian 1.13.0 or later.

### Breaking

- `pick_character` in the generated `_engine.ink` takes the character id as a string (`pick_character("xin")`). Regenerate `_engine.ink` from the game note ("Generate game engine ink" / `api.generateEngine()`): a story that includes an old engine file no longer runs with the engine. (#15)

### Game mode

A story with a `game.md` note next to it is played as a game; the note's frontmatter is the configuration.

- Rules engine: 2d6 sum or d100 roll-under checks on choice tags (`#check:skill:difficulty`), skills as inner voices (`#voice:skill`), resources with `min..max`, companions with their own fear and trust, characters as presets. The engine ink is generated from the note; ids are English and player-facing names are localized (`name: { zh, en }`), bilingual text via `t("中文", "English")`. (#10, #12, #13)
- Panel: character picker, HUD, check odds on choice buttons, voice paragraphs and the dice log; each roll shows as a card in the text with tumbling faces; `#fx:shake|flash|dark|pulse` on a line plays a screen effect when it first appears. (#12, #18)
- Items: `items` in the note, starting items per character, the inventory in the HUD, `#needs:item` locks a choice until the item is carried. (#19)
- Companion-only characters (`playable: false`): in the HUD and the story, never in the picker. (#16)
- Resources are clamped to `min..max` after every step; the overshoot shows up in `check-ink`, never in the HUD. (#21, #22)
- Exported web pages carry the engine, so a game plays in the browser too. (#15)

### Checking stories

- `npm run check-ink -- <folder> --all` plays every branch and lists the endings; a game is walked once per character, through both sides of every check, and a failed check that changes nothing is a warning. `api.explore` does the same from Obsidian. (#9, #14, #17)
- `--novelty` keeps a long game finite (a state is played on only when something about it is new at its spot); every run reports coverage (knots, stitches, labels and choices never reached), knots the compile graph finds unreachable, and resources pushed out of range. `--random N [--seed S]` (`api.simulate`) plays N runs with real dice and reports the odds of each ending and where the resources end up. (#20, #22)
- `npm run export-web -- <main.ink> <out.html>` exports from the command line. (#9)

### Play panel

- After a choice the new text scrolls into view, and a line carrying the chosen option marks where it begins; the top bar can be pinned (pin button on the bar, or the setting). (#17, #23)

### Other

- CI runs the community directory's checks; README shows a demo. (#7, #8)

Older versions: see the [GitHub releases](https://github.com/luoxin9510/inkwright/releases).
