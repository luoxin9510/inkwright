---
version: 1.0
rules: { kind: sum, dice: [6, 6] }
languages: [zh, en]
skills:
  - { id: wits, name: { zh: 机灵, en: Wits } }
characters:
  - { id: crew, name: { zh: 探险队, en: The crew }, skills: { wits: 0 } }
resources:
  - { id: torches, name: { zh: 火把, en: Torches }, min: 0, max: 12, initial: 6 }
  - { id: potions, name: { zh: 药水, en: Potions }, min: 0, max: 9, initial: 2 }
  - { id: gold, name: { zh: 金币, en: Gold }, min: 0, max: 9999, initial: 0 }
party:
  name: { zh: 探险队, en: The crew }
  stats:
    - { id: life, name: { zh: 生命, en: Life }, max: life_max }
    - { id: life_max, hidden: true }
    - { id: might, name: { zh: 力气, en: Might } }
    - { id: guard, name: { zh: 护甲, en: Guard } }
  down: life
  members:
    - { id: blade, name: { zh: 剑手, en: Blade }, stats: { life: 6, life_max: 6, might: 2, guard: 1 } }
    - { id: archer, name: { zh: 弓手, en: Archer }, stats: { life: 5, life_max: 5, might: 2, guard: 0 } }
    - { id: shield, name: { zh: 盾卫, en: Shield }, stats: { life: 7, life_max: 7, might: 1, guard: 2 } }
    - { id: scholar, name: { zh: 学者, en: Scholar }, stats: { life: 4, life_max: 4, might: 1, guard: 0 } }
kinds:
  - id: foe
    name: { zh: 敌人, en: Foes }
    stats:
      - { id: life, name: { zh: 生命, en: Life }, max: life_max }
      - { id: life_max, hidden: true }
      - { id: attack, name: { zh: 攻击, en: Attack } }
      - { id: guard, name: { zh: 护甲, en: Guard } }
    remove: life
    templates:
      - { id: rat, name: { zh: 巨鼠, en: Giant rat }, stats: { life: 1, life_max: 1, attack: 0, guard: 0 } }
      - { id: goblin, name: { zh: 地精, en: Goblin }, stats: { life: 2, life_max: 2, attack: 1, guard: 0 } }
      - { id: skeleton, name: { zh: 骷髅, en: Skeleton }, stats: { life: 2, life_max: 2, attack: 1, guard: 1 } }
      - { id: cultist, name: { zh: 邪教徒, en: Cultist }, stats: { life: 3, life_max: 3, attack: 1, guard: 1 } }
      - { id: ghoul, name: { zh: 食尸鬼, en: Ghoul }, stats: { life: 4, life_max: 4, attack: 2, guard: 1 } }
      - { id: ogre, name: { zh: 食人魔, en: Ogre }, stats: { life: 6, life_max: 6, attack: 2, guard: 1 } }
      - { id: wraith, name: { zh: 怨灵, en: Wraith }, stats: { life: 4, life_max: 4, attack: 2, guard: 2 } }
      - { id: warlord, name: { zh: 深渊督军, en: Pit warlord }, stats: { life: 9, life_max: 9, attack: 3, guard: 2 } }
tables:
  - id: rooms
    name: { zh: 房间, en: Rooms }
    dice: d6
    rows:
      - { range: 1, id: empty, zh: 一间空屋子, en: an empty room }
      - { range: 2-3, id: monsters, zh: 有东西在里面, en: something is in here }
      - { range: 4, id: treasure, zh: 一只落满灰的箱子, en: a dusty chest }
      - { range: 5, id: trap, zh: 地上的石板松了, en: a loose flagstone }
      - { range: 6, id: shrine, zh: 一座古老的祭坛, en: an old shrine }
  - id: shallow
    name: { zh: 浅层的怪物, en: Shallow monsters }
    dice: d6
    rows:
      - { range: 1-2, zh: 一群巨鼠, en: a pack of giant rats, spawn: rat, count: d3+1 }
      - { range: 3-4, zh: 几个地精, en: some goblins, spawn: goblin, count: d2+1 }
      - { range: 5, zh: 两具骷髅, en: two skeletons, spawn: skeleton, count: 2 }
      - { range: 6, zh: 一个邪教徒, en: a cultist, spawn: cultist }
  - id: deep
    name: { zh: 深层的怪物, en: Deep monsters }
    dice: d6
    rows:
      - { range: 1-2, zh: 一队骷髅, en: a file of skeletons, spawn: skeleton, count: d2+1 }
      - { range: 3, zh: 两个邪教徒, en: two cultists, spawn: cultist, count: 2 }
      - { range: 4, zh: 一只食尸鬼, en: a ghoul, spawn: ghoul }
      - { range: 5, zh: 一个食人魔, en: an ogre, spawn: ogre }
      - { range: 6, zh: 一个怨灵, en: a wraith, spawn: wraith }
---

# 地城爬行(Dungeon crawl)规则包 1.0

原创规则,Inkwright 第一方规则系统包。见 `说明.md`。
