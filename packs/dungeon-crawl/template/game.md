---
system: { path: .., version: 1 }
---

# 地城爬行 · 新游戏 / Dungeon crawl · new game

规则、队伍、怪物和表都来自规则包(`system:` 指向的文件夹)。想改什么就在这里写同名的条目,比如换一支队伍(`party:`)、加一种怪物(`kinds:` 里同 id 的 `foe`)、改房间数(在 `main.ink` 里设 `crawl_rooms`)。改完运行「生成游戏引擎 ink」。

The rules, the crew, the monsters and the tables come from the pack (`system:`). To change one, write an entry with the same id here: another crew (`party:`), more monsters (a `foe` kind with the same id), another number of rooms (`crawl_rooms` in `main.ink`). Then run "Generate game engine ink".
