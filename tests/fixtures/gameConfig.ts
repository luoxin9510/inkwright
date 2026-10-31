import type { GameConfig } from "../../src/game/config";

/**
 * A sample game with Chinese ids and ink names (the "zh" preset), bilingual: five skills, fear,
 * two characters. Shared by the game-mode tests.
 */
export const CONFIG: GameConfig = {
  rules: { kind: "sum", dice: [6, 6] },
  languages: ["zh", "en"],
  ink: "zh",
  difficulties: { 轻松: 6, 简单: 8, 普通: 10, 困难: 12, 艰难: 14, 传奇: 16 },
  skills: [
    { id: "理智", name: { zh: "理智", en: "Reason" }, voice: { stance: { zh: "这说得通,撑住。", en: "It adds up. Hold on." }, color: "#7a9cff" } },
    { id: "耐力" }, { id: "魅力" }, { id: "洞察力" }, { id: "力量" },
  ],
  resources: [{ id: "恐惧", min: 0, max: 100, initial: 0 }],
  companionResources: [{ id: "恐惧", min: 0, max: 100, initial: 20 }, { id: "信任", min: 0, max: 100, initial: 50 }],
  items: [
    { id: "手机", name: { zh: "手机", en: "Phone" } },
    { id: "刀", name: { zh: "刀", en: "Knife" }, desc: { zh: "衣柜最里面的那把。", en: "The one from the back of the wardrobe." }, modifiers: { 力量: 1 } },
  ],
  characters: [
    { id: "昕", skills: { 理智: 3, 耐力: 3, 魅力: 6, 洞察力: 3, 力量: 2 }, items: ["手机"] },
    { id: "阿波", skills: { 理智: 4, 耐力: 3, 魅力: 2, 洞察力: 3, 力量: 5 }, companion: { 恐惧: 10, 信任: 60 } },
  ],
  modifiers: [
    { kind: "perStep", resource: "恐惧", step: 25, value: -1, skill: "理智", label: "恐惧" },
    { kind: "when", variable: "受伤", equals: true, value: -2, skill: "力量", label: "受伤" },
  ],
};
