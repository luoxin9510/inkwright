import { describe, expect, test } from "vitest";
import { Compiler, Story } from "inkjs/full";
import { original, speedUpInkjs } from "../src/play/inkjs-speed";
import { PlaySession } from "../src/play/session";

describe("the inkjs speed-up", () => {
  test("inStringEvaluation answers as inkjs's own getter on every step of a story full of strings", () => {
    const src = `VAR n = 0
EXTERNAL f(x)
Start {f(1)} and {"lit" + f(2)}.
- (top)
~ n++
{n}: {label_of(n)} {f(n)}<>
 glued {~a|b|c}.
+ {n < 3} [Go {label_of(n)} {f(n)}] -> top
* [Stop {f(9)}] Stopped {label_of(n)}.
- -> END
=== function label_of(k) ===
~ temp s = "n{k}"
~ return "{s}{f(k)}"
=== function f(x) ===
~ return x
`;
    const story = new Compiler(src).Compile();
    story.BindExternalFunction("f", (x: number) => x * 10, true);
    speedUpInkjs(story);
    expect(original).not.toBeNull();
    let steps = 0;
    let inside = 0;
    const P = Object.getPrototypeOf(story) as { Step(): void };
    const step = P.Step;
    P.Step = function (this: Story) {
      step.call(this);
      const answer = original!.call(this.state);
      expect(this.state.inStringEvaluation).toBe(answer);
      if (answer) inside++;
      steps++;
    };
    try {
      for (let turn = 0; turn < 10; turn++) {
        while (story.canContinue) story.Continue();
        if (story.currentChoices.length === 0) break;
        story.ChooseChoiceIndex(0);
      }
    } finally {
      P.Step = step;
    }
    // Both answers came up many times.
    expect(steps).toBeGreaterThan(100);
    expect(inside).toBeGreaterThan(20);
    expect(steps - inside).toBeGreaterThan(20);
  });

  test("a restart builds the Story from the parsed JSON, and a run after it is the same as the first", () => {
    const src = `~ temp r = RANDOM(1, 1000)
{r}
* [A] A.
* [B] B.
- -> END
`;
    let builds = 0;
    const s = new PlaySession(new Compiler(src).Compile(), { setup: () => builds++, prepare: (st) => { st.state.storySeed = 5; st.state.previousRandom = 0; } });
    const first = [s.start().paragraphs[0].text, s.choose(0).paragraphs[0].text];
    const again = [s.restart().paragraphs[0].text, s.choose(0).paragraphs[0].text];
    expect(again).toEqual(first);
    // setup ran for the first Story and again for the restarted one.
    expect(builds).toBe(2);
  });
});
