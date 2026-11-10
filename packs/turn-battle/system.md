---
version: "1.0"
pack:
  name: { zh: 回合战斗, en: Turn battle }
  description: { zh: "三人小队对一群敌人,按速度轮流出手(攻击、技能、防御、药水,中毒和眩晕)", en: "A party of three against a band of foes, taking turns by speed (attacks, arts, guarding, potions, poison and stun)" }
rules: { kind: sum, dice: [6, 6] }
languages: [zh, en]
skills:
  - { id: wits, name: { zh: 机灵, en: Wits } }
characters:
  - { id: party, name: { zh: 小队, en: The party }, skills: { wits: 0 } }
resources:
  - { id: potions, name: { zh: 药水, en: Potions }, min: 0, max: 9, initial: 2 }
statuses:
  - { id: poison, name: { zh: 中毒, en: Poisoned }, desc: { zh: 每回合结束 -2 生命, en: "-2 HP at the end of each round" }, rest: true }
  - { id: stun, name: { zh: 眩晕, en: Stunned }, desc: { zh: 下一次行动被跳过, en: "Loses the next turn" } }
  - { id: guard, name: { zh: 防御, en: Guarding }, desc: { zh: "防御 +3,直到自己下次行动", en: "+3 defence until the next own turn" } }
party:
  name: { zh: 小队, en: The party }
  stats:
    - { id: hp, name: { zh: 生命, en: HP }, max: hp_max }
    - { id: hp_max, hidden: true }
    - { id: mp, name: { zh: 法力, en: MP }, max: mp_max }
    - { id: mp_max, hidden: true }
    - { id: atk, name: { zh: 攻击, en: Attack } }
    - { id: def, name: { zh: 防御, en: Defence } }
    - { id: spd, name: { zh: 速度, en: Speed } }
    - { id: art, hidden: true }
    - { id: acted, hidden: true }
  down: hp
  members:
    - { id: knight, name: { zh: 骑士, en: Knight }, stats: { hp: 18, hp_max: 18, mp: 4, mp_max: 4, atk: 4, def: 2, spd: 3, art: 1 } }
    - { id: mage, name: { zh: 法师, en: Mage }, stats: { hp: 11, hp_max: 11, mp: 9, mp_max: 9, atk: 2, def: 0, spd: 4, art: 2 } }
    - { id: cleric, name: { zh: 牧师, en: Cleric }, stats: { hp: 13, hp_max: 13, mp: 8, mp_max: 8, atk: 3, def: 1, spd: 2, art: 3 } }
kinds:
  - id: foe
    name: { zh: 敌人, en: Foes }
    stats:
      - { id: hp, name: { zh: 生命, en: HP }, max: hp_max }
      - { id: hp_max, hidden: true }
      - { id: atk, name: { zh: 攻击, en: Attack } }
      - { id: def, name: { zh: 防御, en: Defence } }
      - { id: spd, name: { zh: 速度, en: Speed } }
      - { id: venom, hidden: true }
      - { id: acted, hidden: true }
    remove: hp
    templates:
      - { id: goblin, name: { zh: 地精, en: Goblin }, stats: { hp: 15, hp_max: 15, atk: 3, def: 1, spd: 5 } }
      - { id: orc, name: { zh: 兽人, en: Orc }, stats: { hp: 26, hp_max: 26, atk: 6, def: 2, spd: 1 } }
      - { id: shaman, name: { zh: 萨满, en: Shaman }, stats: { hp: 18, hp_max: 18, atk: 2, def: 0, spd: 3, venom: 1 } }
      - { id: wolf, name: { zh: 灰狼, en: Grey wolf }, stats: { hp: 7, hp_max: 7, atk: 3, def: 0, spd: 6 } }
      - { id: troll, name: { zh: 巨魔, en: Troll }, stats: { hp: 24, hp_max: 24, atk: 6, def: 3, spd: 1 } }
---

# 回合战斗(Turn battle)规则包 1.0

原创规则,Inkwright 第一方规则系统包。见 `说明.md`。
