import { afterEach, describe, expect, test } from "vitest";
import { setLanguage } from "../src/i18n";
import type { CheckRecord, ChoicePlay, DiceRecord } from "../src/game/engine";
import type { PlacedAside } from "../src/play/session";
import { describeStop, diceLabel, diceResult, logLine, manualLine, noteText, pickHint } from "../src/play/describe";

afterEach(() => setLanguage("zh"));

const dice = (o: Partial<DiceRecord> = {}): DiceRecord => ({ kind: "dice", formula: "2d6", rolls: [3, 4], total: 7, index: 0, turn: 0, ...o });
const check = (o: Partial<CheckRecord> = {}): CheckRecord => ({
  kind: "check", skill: "str", difficulty: 8, level: 2, rolls: [3, 4], total: 10, band: 3, modifiers: [{ value: 1, source: "撬棍" }],
  chance: { success: 0.58, bands: [0, 0.4, 0, 0.58, 0] }, index: 0, turn: 0, ...o,
} as CheckRecord);
const skills = [{ id: "str", name: "力量" }];

describe("roll words", () => {
  test("free dice name what they were for and what came out", () => {
    expect(diceLabel(dice())).toBe("2d6");
    expect(diceResult(dice())).toBeUndefined();
    const table = dice({ table: { id: "enc", name: "遭遇", text: "狼" } });
    expect([diceLabel(table), diceResult(table)]).toEqual(["遭遇 2d6", "狼"]);
    const deck = dice({ deck: { id: "d", name: "牌堆", card: "火把", cardId: "torch" } });
    expect([diceLabel(deck), diceResult(deck)]).toEqual(["牌堆", "火把"]);
    const rec = dice({ record: { id: "clues", name: "线索", entry: "钥匙" } });
    expect([diceLabel(rec), diceResult(rec)]).toEqual(["线索", "钥匙"]);
  });

  test("the dice log says the same as the cards", () => {
    expect(logLine(dice({ table: { id: "enc", name: "遭遇", text: "狼" } }), skills)).toEqual(["遭遇 2d6", "3+4 = 7 · 狼"]);
    expect(logLine(dice({ unknown: true, rolls: [] }), skills)).toEqual(["2d6", "(公式不对)"]);
    expect(logLine(check(), skills)).toEqual(["力量 8", "3+4 +2 +1 = 10 · 成功 (58%)"]);
    expect(logLine(check({ skill: "dex", unknown: true }), skills)[0]).toBe("dex (未知技能) 8");
  });
});

describe("stops and notes", () => {
  test("each reason has its words; going on by index only where a choice did not match", () => {
    const mismatch = describeStop({ reason: "mismatch", step: 2, pending: 3, older: true });
    expect(mismatch.text).toContain("第 2 步");
    expect(mismatch).toMatchObject({ byIndex: true, older: true });
    expect(describeStop({ reason: "start", step: 1, pending: 3, detail: "k" })).toMatchObject({ byIndex: false, older: false });
    expect(describeStop({ reason: "start", step: 1, pending: 3, detail: "k" }).text).toContain('"k"');
    expect(describeStop({ reason: "chosen", step: 4, pending: 0 }).byIndex).toBe(false);
    for (const reason of ["mismatch", "error", "budget", "start", "character", "chosen"] as const) {
      expect(describeStop({ reason, step: 1, pending: 1 }).text).not.toBe("");
    }
  });

  test("a note puts what the replay noticed on one line", () => {
    expect(noteText({ guesses: 0, skipped: 0, drift: 3 })).toBe("从第 3 步起,结果和原来不同(掷骰或之后的选项变了)。");
    expect(noteText({ guesses: 2, skipped: 0, drift: null })).toContain("2 步");
  });
});

describe("changes by hand and card picks", () => {
  const names = { records: [{ id: "clues", name: "线索" }], resources: [{ id: "hp", name: "生命" }] };
  const aside = (o: Partial<PlacedAside>): PlacedAside => ({ seq: 0, at: 0, after: 0, lang: null, kind: "adjust", ...o } as PlacedAside);

  test("a change by hand names the resource or record", () => {
    expect(manualLine(aside({ kind: "adjust", var: "hp", delta: -1, result: { from: 5, to: 4 } }), names)).toBe("✎ 生命 -1(5 → 4)");
    expect(manualLine(aside({ kind: "set", var: "hp", value: 9, result: null }), names)).toBe("✎ 生命 = 9");
    expect(manualLine(aside({ kind: "record", var: "clues", op: "add", entry: "钥匙" }), names)).toBe("📝 线索 + 钥匙");
    expect(manualLine(aside({ kind: "record", var: "gone", op: "remove", entry: "x" }), names)).toBe("📝 gone − x");
  });

  test("a #play choice says what it waits for", () => {
    const play = (o: Partial<ChoicePlay>): ChoicePlay => ({ hand: "h", name: "手牌", cards: [{ id: "a" }, { id: "b" }] as ChoicePlay["cards"], known: true, min: 1, max: 1, ...o });
    expect(pickHint(play({}))).toBe("先选一张牌");
    expect(pickHint(play({ min: 1, max: 2 }))).toBe("选 1–2 张牌");
    expect(pickHint(play({ cards: [] }))).toBe("手牌 · 空");
    expect(pickHint(play({ min: 3, max: 3 }))).toBe("手牌 · 空");
  });
});
