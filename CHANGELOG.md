# Changelog

Release notes for each version; the GitHub release carries the same text and the built plugin.

## Unreleased

- Game mode, tabletop slice 1 (`docs/tabletop-prd.md`): free dice and random tables. `{roll("2d6+3")}` (also `d20`, `d%`, `d66`) rolls outside a check. `tables:` in the game note lists random tables, rows with a dice range and bilingual text, written inline or read `from:` the first markdown table of another note (a `1d6`/`d66` column header names the dice; `zh`/`en` columns the text; an `id` column the row ids); `{table("encounter")}` rolls one and reads the row, `table_roll`/`table_text`/`table_id` serve stories that branch on the result. Every roll shows as a card in the text and in the dice log, in the panel and the exported page, and follows the run's seed, so back, load and language replay roll the same; the generated ink keeps a story playable without the engine (flat dice). The explorer and `check-ink` roll tables from a fixed seed; the game note's table problems (no rows, bad dice, gaps or overlaps in the ranges, a note without a table) are reported like the other config problems.
- Decks (tabletop slice 2): `decks:` in the game note (id, name, `cards` with id, name, desc). The generated ink declares `LIST <deck>` and `VAR <deck>_pile`; `draw("clues")` takes a random card out of the pile without replacement (an empty list once it is empty), `shuffle("clues")` puts every card back, `deck_left("clues")` counts the pile, and a hand is any list the story keeps (`~ hand += draw("clues")`). The draw rolls through the engine's seeded dice, so back, load and replay draw the same; it shows as a card in the text (deck and card, description on hover) and in the dice log, and the HUD lists each pile (`hud().decks`).
- Hands and card play (tabletop slice 3): `hands:` in the game note names the list variables that hold cards (`{ id: hand, name }`; the generated ink declares `VAR hand = ()` and `VAR played = ()`, the story still adds and removes). The panel and the exported page draw each hand as a row of cards between the text and the choices: tap a card to pick it (its description shows under the row), tap again to put it back; the row scrolls sideways on a phone. A choice tagged `#play:hand` waits for a card from that hand, reads "Play a card · Torch" once one is picked, and is taken with it: the engine writes the card into `played` just before the choice runs (`~ hand -= played`, `{ played == torch: … }`); with no card to play the choice is locked like a missing item. The card is part of the choice, so back, save, load and the language replay play it again; the journal and the turn line name it. The explorer plays a `#play` choice once per card in the hand (`出一张 ▸ 手电` in the paths), the random player picks one at random, and a `#play` naming a hand the note does not have is a warning. `api.choose(choice, cardId)` plays a card; `panel().game.plays` and `hud().hands` list them.
- "Write this session to a note" (command `inkwright:write-journal`, `api.journal()`): the panel's run so far, text, choices and roll cards, as a markdown note. `journal.path` in the game note says where (`{dir}`, `{story}`, `{date}`, `{time}`, `{character}`; default `{dir}日志/{date} {time}.md`); an existing note is never overwritten.
- `check-ink --novelty 2` (and `api.explore(path, { novelty: 2 })`): the explorer judges novelty again within each value of a gate (a variable some choice condition reads), so a branch that needs two things to agree (a door opened in one place, hours or a reading kept from another) is reached where the one-at-a-time rule had already seen each piecewise. Slower; `--novelty` alone is unchanged. `api.explore` also returns `steps`, the choices made, and `check-ink` prints it.
- Tutorial (ink-games vault): chapter 7, game mode, in five lessons with example games (configuration and engine, checks and voices, resources and companions, items and effects, checking and export); lesson 6.1 notes the tags game mode reads.

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
