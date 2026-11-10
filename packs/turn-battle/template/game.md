---
system: { path: .., version: 1 }
---

# 回合战斗 · 新游戏 / Turn battle · new game

规则、小队和敌人都来自规则包(`system:` 指向的文件夹)。想改什么就在这里写同名的条目,比如换一支小队(`party:`)、加一种敌人(`kinds:` 里同 id 的 `foe`)。敌人在 `main.ink` 里用 `spawn("foe", "goblin")` 叫出来。改完运行「生成游戏引擎 ink」。

The rules, the party and the foes come from the pack (`system:`). To change one, write an entry with the same id here: another party (`party:`), more foes (a `foe` kind with the same id). The foes are called up in `main.ink` with `spawn("foe", "goblin")`. Then run "Generate game engine ink".
