---
version: 1.2
rules: { kind: sum, dice: [6, 6] }
skills:
  - { id: might, name: Might }
  - { id: wits, name: Wits }
characters:
  - { id: hero, name: Hero, skills: { might: 1, wits: 1 } }
resources:
  - { id: hp, name: Health, min: 0, max: 6, initial: 6 }
kinds:
  - id: foe
    stats: [ { id: life }, { id: bite } ]
    remove: life
    templates:
      - { id: rat, name: Rat, stats: { life: 1, bite: 1 } }
      - { id: ogre, name: Ogre, stats: { life: 3, bite: 2 } }
tables:
  - { id: lair, name: Lair, from: 表/lair.md }
---

A test pack: a fight procedure in rules.ink and a lair table kept in a note.
