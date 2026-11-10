---
system: { path: .., version: 1 }
characters:
  - { id: me, name: { zh: 我, en: Me }, skills: { reason: 3, stamina: 3, charm: 3, insight: 4, strength: 2 } }
  - { id: lin, playable: false, name: { zh: 林, en: Lin }, skills: { reason: 4, stamina: 2, charm: 3, insight: 3, strength: 2 }, companion: { fear: 30, trust: 50 } }
---

# 叙事检定 · 新游戏 / Narrative checks · new game

规则、技能、恐惧和体力都来自规则包(`system:` 指向的文件夹);角色写在这里。想改什么就在这里写同名的条目,比如换一个技能的声音(`skills:` 里同 id 的条目)、加一种资源(`resources:`)。改完运行「生成游戏引擎 ink」。

The rules, the skills, fear and stamina come from the pack (`system:`); the characters are written here. To change one, write an entry with the same id here: another voice for a skill (a `skills:` entry with the same id), one more resource (`resources:`). Then run "Generate game engine ink".
