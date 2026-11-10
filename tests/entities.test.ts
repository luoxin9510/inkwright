import { describe, expect, test } from "vitest";
import { entAt, entCount, entDrop, entGet, entHas, entLabel, entPick, entSet, entSpawn, entities, entityStore } from "../src/game/entities";

describe("entity store", () => {
  test("spawned entities keep their order, template and stats; the same id is not spawned twice", () => {
    let s = entSpawn("", "goblin1", "goblin", { life: 3, attack: 1 });
    s = entSpawn(s, "orc2", "orc", { life: 5 });
    expect(s).toBe("goblin1|goblin|life=3,attack=1;orc2|orc|life=5");
    expect(entSpawn(s, "orc2", "orc", { life: 9 })).toBe(s);
    expect(entSpawn(s, "", "orc", {})).toBe(s);
    expect(entities(s).map((e) => e.id)).toEqual(["goblin1", "orc2"]);
    expect(entityStore(entities(s))).toBe(s);
    expect([entCount(s), entAt(s, 1), entAt(s, 2), entAt(s, 3)]).toEqual([2, "goblin1", "orc2", ""]);
  });

  test("stats are read and set; an unknown entity or stat reads 0 and changes nothing", () => {
    const s = entSpawn("", "g1", "goblin", { life: 3 });
    expect([entHas(s, "g1"), entHas(s, "x"), entGet(s, "g1", "life"), entGet(s, "g1", "attack"), entGet(s, "x", "life")]).toEqual([true, false, 3, 0, 0]);
    expect(entGet(entSet(s, "g1", "attack", 2), "g1", "attack")).toBe(2);
    expect(entSet(s, "x", "life", 1)).toBe(s);
  });

  test("setting the remove stat to 0 or less takes the entity out; other stats at 0 do not", () => {
    let s = entSpawn(entSpawn("", "g1", "goblin", { life: 3, rage: 1 }), "g2", "goblin", { life: 1 });
    expect(entCount(entSet(s, "g1", "rage", 0, "life"))).toBe(2);
    s = entSet(s, "g2", "life", -1, "life");
    expect(entities(s).map((e) => e.id)).toEqual(["g1"]);
    expect(entCount(entSet(s, "g1", "life", 0, ""))).toBe(1);
    expect(entDrop(s, "g1")).toBe("");
    expect(entDrop(s, "zz")).toBe(s);
  });

  test("picks without dice: first, last, the lowest or highest of a stat (the earliest on a tie)", () => {
    let s = "";
    for (const [id, life] of [["a", 3], ["b", 1], ["c", 1], ["d", 4]] as const) s = entSpawn(s, id, "t", { life });
    expect(["first", "last", "lowest:life", "highest:life", "random", "lowest:none"].map((h) => entPick(s, h))).toEqual(["a", "d", "b", "d", "", "a"]);
    expect(entPick("", "first")).toBe("");
  });

  test("labels number entities of the same template", () => {
    let s = entSpawn("", "goblin1", "goblin", {});
    expect(entLabel(s, "goblin1", () => "哥布林")).toBe("哥布林");
    s = entSpawn(entSpawn(s, "orc2", "orc", {}), "goblin3", "goblin", {});
    const names = (t: string) => (t === "goblin" ? "哥布林" : "兽人");
    expect(["goblin1", "orc2", "goblin3", "x"].map((id) => entLabel(s, id, names))).toEqual(["哥布林 1", "兽人", "哥布林 2", ""]);
  });
});
