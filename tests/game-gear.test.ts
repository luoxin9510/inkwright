import { describe, expect, test } from "vitest";
import { Compiler } from "inkjs/full";
import { collectModifiers, readConfig, type GameConfig } from "../src/game/config";
import { GameEngine } from "../src/game/engine";
import { generateInk } from "../src/game/inkgen";
import { PlaySession } from "../src/play/session";

// RPG R4: stacking items, equipment slots and statuses.
const FM = {
  rules: { kind: "sum", dice: [6, 6] },
  skills: [{ id: "might" }, { id: "wits" }],
  characters: [{ id: "you", skills: { might: 1, wits: 1 }, items: ["dagger", "sword"], counts: { arrow: 3 } }],
  slots: [{ id: "weapon", name: { zh: "武器", en: "Weapon" } }],
  items: [
    { id: "arrow", name: { zh: "箭", en: "Arrow" }, stack: true },
    { id: "dagger", slot: "weapon", modifiers: { might: 1 } },
    { id: "sword", slot: "weapon", modifiers: { might: 2 } },
    { id: "charm", modifiers: { wits: 1 } },
  ],
  statuses: [
    { id: "poison", name: { zh: "中毒", en: "Poisoned" }, rest: true },
    { id: "blessed", name: { zh: "祝福", en: "Blessed" }, modifiers: { wits: 2 } },
  ],
  party: { stats: [{ id: "life" }], members: [{ id: "ann", stats: { life: 3 } }] },
};
const GAME = readConfig(FM).config as GameConfig;

const STORY = `-> start
${generateInk(GAME)}
=== start ===
Arrows {inv_count(arrow)} {inv ? arrow}. Worn {equipped}.
~ temp shot = take(arrow, 2)
Shot {shot}, left {inv_count(arrow)}.
~ shot = take(arrow, 5)
Shot {shot}, left {inv_count(arrow)}, carried {inv ? arrow}.
~ give(arrow, 4)
~ give(charm, 1)
Now {inv_count(arrow)} {inv ? arrow}, charm {inv_count(charm)}.
~ equip(sword)
Worn {equipped}.
~ add_status("ann", "poison", 2)
~ add_status("me", "blessed", 0)
Poisoned {has_status("ann", "poison")} for {status_turns("ann", "poison")}.
+ [Go on]
-
~ tick_statuses()
After a turn {status_turns("ann", "poison")}.
~ rest_statuses()
After a rest {has_status("ann", "poison")}, blessed {has_status("me", "blessed")}.
-> END
`;

const compiled = () => new Compiler(STORY).Compile();

describe("stacks, slots and statuses", () => {
  test("the config reads; a count of a non-stacking item, an unknown slot and a status's unknown skill are problems", () => {
    expect(readConfig(FM).problems).toEqual([]);
    const bad = readConfig({ ...FM, characters: [{ id: "you", skills: {}, counts: { sword: 1 } }], items: [...FM.items, { id: "hat", slot: "head" }], statuses: [{ id: "x", modifiers: { luck: 1 } }] });
    expect(bad.problems.map((p) => p.code).sort()).toEqual(["countItem", "itemSlot", "statusSkill"]);
  });

  test("with the engine: counts follow give/take, equipping swaps the slot, statuses count down and rest away", () => {
    const engine = new GameEngine(GAME);
    engine.language = "en";
    const s = new PlaySession(compiled(), { setup: (st) => engine.setup(st, "you"), prepare: (st) => engine.seed(st, 1) });
    const first = s.start();
    expect(first.paragraphs.map((p) => p.text)).toEqual([
      "Arrows 3 true. Worn dagger.",
      "Shot 2, left 1.",
      "Shot 1, left 0, carried false.",
      "Now 4 true, charm 1.",
      "Worn sword.",
      "Poisoned true for 2.",
    ]);
    const hud = engine.hud();
    expect(hud.items).toEqual([
      { id: "arrow", name: "Arrow", count: 4 },
      { id: "dagger", name: "dagger", slot: "Weapon", equipped: false },
      { id: "sword", name: "sword", slot: "Weapon", equipped: true },
      { id: "charm", name: "charm" },
    ]);
    expect(hud.statuses).toEqual([{ id: "blessed", name: "Blessed", turns: 0 }]);
    expect(hud.party?.members[0].statuses).toEqual([{ id: "poison", name: "Poisoned", turns: 2 }]);
    // Only the equipped weapon counts; an item without a slot counts while carried; the character's own status too.
    const read = (n: string) => (s as unknown as { story: { variablesState: Record<string, unknown> } }).story.variablesState[n];
    expect(collectModifiers(GAME, "might", read).map((m) => m.value)).toEqual([2]);
    expect(collectModifiers(GAME, "wits", read, "en").map((m) => [m.source, m.value])).toEqual([["charm", 1], ["Blessed", 2]]);
    const end = s.choose(0);
    expect(end.paragraphs.map((p) => p.text)).toEqual(["After a turn 1.", "After a rest false, blessed true."]);
  });

  test("without the engine it compiles and plays: counts and slots work, no status takes hold", () => {
    const s = new PlaySession(compiled());
    const first = s.start();
    expect(first.paragraphs.map((p) => p.text).at(-1)).toBe("Poisoned false for 0.");
    expect(s.choose(0).ended).toBe(true);
  });

  test("the zh ink names compile", () => {
    const zh = readConfig({ ...FM, ink: "zh" }).config as GameConfig;
    expect(readConfig({ ...FM, ink: "zh" }).problems).toEqual([]);
    const src = `~ 给(arrow, 2)\n~ 装备上(sword)\n~ 加状态("我", "poison", 1)\n{有几个(arrow)} {有状态("我", "poison")}\n-> END\n${generateInk(zh)}`;
    expect(() => new Compiler(src).Compile()).not.toThrow();
  });
});
