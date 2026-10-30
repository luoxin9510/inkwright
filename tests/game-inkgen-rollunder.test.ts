import { expect, test } from "vitest";
import { Compiler, Story } from "inkjs/full";
import { generateInk } from "../src/game/inkgen";
import { CONFIG } from "./fixtures/gameConfig";
test("roll-under fallback agrees with the engine: average roll (50.5) vs skill", () => {
  const ink = generateInk({ ...CONFIG, rules: { kind: "rollUnder", sides: 100 }, skills: [{ id: "侦察", max: 100 }], characters: [{ id: "昕", skills: { 侦察: 60 } }, { id: "乙", skills: { 侦察: 40 } }] });
  const c = new Compiler("-> main\n" + ink + "\n=== main ===\n~ 选主角(昕)\n{检定(\"侦察\", 0)}\n~ 选主角(乙)\n{检定(\"侦察\", 0)}\n-> END\n");
  const s = new Story(c.Compile().ToJson() as string);
  s.allowExternalFunctionFallbacks = true;
  let out = ""; while (s.canContinue) out += s.Continue();
  expect(out.trim().split(/\s+/)).toEqual(["3", "1"]);
});
