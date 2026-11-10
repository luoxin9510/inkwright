import { describe, expect, test } from "vitest";
import { statusAdd, statusClear, statusEntries, statusHas, statusRest, statusTick, statusTurns } from "../src/game/statuses";

describe("status store", () => {
  test("adding: new entries in order, the longer duration wins, 0 = until cleared", () => {
    let s = statusAdd("", "blade", "poison", 3);
    expect(s).toBe("blade|poison|3");
    s = statusAdd(s, "rat_1", "stun", 1);
    s = statusAdd(s, "blade", "poison", 2);
    expect(statusTurns(s, "blade", "poison")).toBe(3);
    s = statusAdd(s, "blade", "poison", 5);
    expect(statusTurns(s, "blade", "poison")).toBe(5);
    s = statusAdd(s, "me", "blessed", 0);
    s = statusAdd(s, "me", "blessed", 4);
    expect(statusHas(s, "me", "blessed")).toBe(true);
    expect(statusTurns(s, "me", "blessed")).toBe(0);
    expect(statusEntries(s).map((e) => e.who)).toEqual(["blade", "rat_1", "me"]);
    expect(statusAdd(s, "", "x", 1)).toBe(s);
  });

  test("a turn passes: counting statuses lose one and end at 0, lasting ones stay", () => {
    let s = "blade|poison|2;rat_1|stun|1;me|blessed|0";
    s = statusTick(s);
    expect(s).toBe("blade|poison|1;me|blessed|0");
    s = statusTick(s);
    expect(s).toBe("me|blessed|0");
    expect(statusHas(s, "blade", "poison")).toBe(false);
  });

  test("clearing one status, all of someone's, and a rest", () => {
    const s = "blade|poison|2;blade|stun|1;archer|poison|0;me|curse|0";
    expect(statusClear(s, "blade", "poison")).toBe("blade|stun|1;archer|poison|0;me|curse|0");
    expect(statusClear(s, "blade", "")).toBe("archer|poison|0;me|curse|0");
    expect(statusRest(s, new Set(["poison"]))).toBe("blade|stun|1;me|curse|0");
    expect(statusEntries("junk;a|b|x;|c|1")).toEqual([{ who: "a", id: "b", turns: 0 }]);
  });
});
