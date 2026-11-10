import type { Story } from "inkjs/full";

/** inkjs's ControlCommand.CommandType.BeginString (the enum is not exported). */
const BEGIN_STRING = 7;

/**
 * inkjs asks `state.inStringEvaluation` after every step, and its getter walks the whole output stream calling a
 * type-check helper per item: some 12% of a long game's run time (the 4AD port). This replaces the getter on the
 * StoryState prototype with the same walk without the helper call (only ControlCommand has `commandType`). Same
 * answers, so nothing a story does can tell; applied once, the first time a session attaches a Story.
 */
export function speedUpInkjs(story: Story): void {
  const proto = Object.getPrototypeOf(story.state) as object;
  if (Object.prototype.hasOwnProperty.call(proto, PATCHED)) return;
  Object.defineProperty(proto, PATCHED, { value: true });
  // PropertyDescriptor declares `get` as a method; read it as the plain function it is.
  const own: { get?: (this: unknown) => boolean } | undefined = Object.getOwnPropertyDescriptor(proto, "inStringEvaluation");
  original = own?.get ?? null;
  Object.defineProperty(proto, "inStringEvaluation", {
    configurable: true,
    get(this: { outputStream: { commandType?: number }[] }): boolean {
      const stream = this.outputStream;
      for (let i = stream.length - 1; i >= 0; i--) if (stream[i].commandType === BEGIN_STRING) return true;
      return false;
    },
  });
}

const PATCHED = "__inkwrightFastStringEvaluation";

/** inkjs's own getter, kept for the test that compares the two on every step. */
export let original: ((this: unknown) => boolean) | null = null;
