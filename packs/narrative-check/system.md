---
version: "1.0"
pack:
  name: { zh: 叙事检定, en: Narrative checks }
  description: { zh: "2d6 + 技能对难度的检定,五种技能各是一个内心的声音,恐惧和体力两条血条,同伴的恐惧和信任", en: "2d6 + skill against a difficulty, five skills that are inner voices, fear and stamina, companions' fear and trust" }
rules: { kind: sum, dice: [6, 6] }
languages: [zh, en]
difficulties: { trivial: 6, easy: 8, normal: 10, hard: 12, severe: 14, legendary: 16 }
skills:
  - { id: reason, name: { zh: 理智, en: Reason }, voice: { stance: { zh: "这说得通,撑住。", en: "It adds up. Hold on." }, color: "#7a9cff" } }
  - { id: stamina, name: { zh: 耐力, en: Stamina }, voice: { stance: { zh: 再坚持一下。, en: "Just a little longer." }, color: "#8fbf6a" } }
  - { id: charm, name: { zh: 魅力, en: Charm }, voice: { stance: { zh: 这事能谈。, en: "We can talk about this." }, color: "#e6a23c" } }
  - { id: insight, name: { zh: 洞察力, en: Insight }, voice: { stance: { zh: 注意到了吗。, en: "Did you notice?" }, color: "#b07cd8" } }
  - { id: strength, name: { zh: 力量, en: Strength }, voice: { stance: { zh: 砸。, en: "Smash it." }, color: "#e26a6a" } }
resources:
  - { id: fear, name: { zh: 恐惧, en: Fear }, min: 0, max: 100, initial: 0 }
  - { id: hp, name: { zh: 体力, en: Stamina }, min: 0, max: 10, initial: 10 }
companionResources:
  - { id: fear, name: { zh: 恐惧, en: Fear }, min: 0, max: 100, initial: 20 }
  - { id: trust, name: { zh: 信任, en: Trust }, min: 0, max: 100, initial: 50 }
modifiers:
  - { kind: perStep, resource: fear, step: 25, value: -1, skill: reason, label: fear }
---

# 叙事检定(Narrative checks)规则包 1.0

从宿舍恐怖游戏《302》的规则整理出来的第一方规则系统包。见 `说明.md`。
