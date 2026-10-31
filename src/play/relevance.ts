/**
 * What in a compiled story decides its future, read off the runtime JSON (story.ToJson()):
 * which global variables can change what happens next, the named places whose visits are
 * counted, the choice points, and the containers whose own visit count picks their next line
 * (sequences). The explorer uses it to tell states apart by what matters and to measure coverage.
 */

export interface StoryShape {
  /**
   * Global variables read somewhere other than into text or into themselves: in a condition,
   * a choice condition, a function argument, a return, or into another such variable.
   */
  relevant: Set<string>;
  /** Author-named containers whose visits are counted (knots, stitches, labels), as the state's visitCounts name them. */
  places: { path: string; name: string }[];
  /** Choice points, as currentChoices[].originalChoicePath names them, with the place they belong to. */
  choices: { path: string; place: string }[];
  /** Containers whose next line depends on their own visit count (sequences, cycles, shuffles), or on a read count. */
  counted: Set<string>;
  /** Names called as functions (ink or EXTERNAL): their containers are code, not places the reader gets to. */
  functions: Set<string>;
  /** The constants each variable is compared with (`hp <= 2`, `battery == 0`), sorted: where its value changes something. */
  thresholds: Map<string, number[]>;
}

const COMPARISONS = new Set(["<", "<=", ">", ">=", "==", "!="]);

/** Compiler-generated container names (choice/gather/index), not author-written. */
export const INTERNAL = /^(\d+|[cg]-\d+)$/;

/** A path as the author would name it: the compiler-generated segments left out ("k.s.0.talk" -> "k.s.talk"). */
export function placeName(path: string): string {
  return path.split(".").filter((seg) => !INTERNAL.test(seg)).join(".");
}

const asArray = (v: unknown): unknown[] | null => (Array.isArray(v) ? (v as unknown[]) : null);
const asMeta = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function storyShape(json: unknown, globals: Iterable<string>): StoryShape {
  const names = new Set(globals);
  const reads = new Set<string>();
  // x -> y: x is assigned into y (y = f(x)); x matters when y does.
  const feeds = new Map<string, Set<string>>();
  const shape: StoryShape = { relevant: new Set(), places: [], choices: [], counted: new Set(), functions: new Set(), thresholds: new Map() };
  const threshold = (name: string, value: unknown) => {
    if (typeof value !== "number") return;
    const list = shape.thresholds.get(name) ?? [];
    if (!list.includes(value)) shape.thresholds.set(name, [...list, value].sort((a, b) => a - b));
  };
  const feed = (x: string, y: string) => {
    if (!feeds.has(x)) feeds.set(x, new Set());
    feeds.get(x)?.add(y);
  };

  /**
   * The reads in one container's ops. An `ev … /ev` block evaluates an expression; what it is for
   * shows in the block: an assignment op (`VAR=` / `temp=`) takes the value, `out` prints it, and a
   * value left at `/ev` goes to a condition, a choice, a divert or a return. Text being built
   * (`str … /str`) can hold conditions of its own; those only pick words. Blocks nest (an
   * interpolation inside a string), so each is its own frame.
   */
  const scan = (container: unknown[]) => {
    const frames: string[][] = [];
    let text = 0;
    for (let i = 0; i < container.length; i++) {
      const op = container[i];
      if (op === "ev") {
        frames.push([]);
        continue;
      }
      if (op === "/ev") {
        // The value may be taken by an assignment right after the block.
        const next = asMeta(container[i + 1]);
        const target = next?.["VAR="] ?? next?.["temp="];
        for (const name of frames.pop() ?? []) {
          if (typeof target !== "string") reads.add(name);
          else if (name === target) continue;
          else if (typeof next?.["VAR="] === "string" && names.has(target)) feed(name, target);
          else reads.add(name);
        }
        if (typeof target === "string") i++;
        continue;
      }
      if (op === "str") text++;
      else if (op === "/str") text--;
      const meta = asMeta(op);
      if (!meta) continue;
      const called = meta["f()"] ?? meta["x()"];
      if (typeof called === "string") shape.functions.add(called);
      const cnt = meta["CNT?"];
      if (typeof cnt === "string") shape.counted.add(cnt);
      const frame = frames[frames.length - 1];
      const target = meta["VAR="] ?? meta["temp="];
      if (typeof target === "string" && frame) {
        for (const name of frame) {
          if (name === target) continue;
          if (typeof meta["VAR="] === "string" && names.has(target)) feed(name, target);
          else reads.add(name);
        }
        frame.length = 0;
        continue;
      }
      const name = meta["VAR?"];
      if (typeof name !== "string" || !names.has(name)) continue;
      if (text > 0 || container[i + 1] === "out") continue;
      // `x op c` and `c x op`: the constant is a threshold of x.
      if (typeof container[i + 2] === "string" && COMPARISONS.has(container[i + 2] as string)) threshold(name, container[i + 1]);
      if (typeof container[i + 1] === "string" && COMPARISONS.has(container[i + 1] as string)) threshold(name, container[i - 1]);
      if (frame) frame.push(name);
      else reads.add(name);
    }
    for (const frame of frames) for (const name of frame) reads.add(name);
  };

  // A container with a `~ return` in it is a function, called or not.
  const returns = (container: unknown[]): boolean =>
    container.some((e) => e === "~ret" || (asArray(e) !== null && returns(asArray(e) ?? [])))
    || Object.values(asMeta(container[container.length - 1]) ?? {}).some((v) => asArray(v) !== null && returns(asArray(v) ?? []));
  const isCounted = (meta: Record<string, unknown> | null): boolean => {
    const flags = meta?.["#f"];
    return typeof flags === "number" && (flags & 1) !== 0;
  };
  const walk = (container: unknown[], path: string, place: string) => {
    const meta = asMeta(container[container.length - 1]);
    if (container.includes("visit") || container.includes("seq")) shape.counted.add(path);
    scan(container);
    for (let i = 0; i < container.length; i++) {
      const e = container[i];
      const sub = asArray(e);
      if (sub) {
        const subMeta = asMeta(sub[sub.length - 1]);
        const named = subMeta?.["#n"];
        const name = typeof named === "string" ? named : null;
        const subPath = join(path, name ?? String(i));
        if (name && isCounted(subMeta) && !INTERNAL.test(name)) shape.places.push({ path: subPath, name: placeName(subPath) });
        walk(sub, subPath, name && !INTERNAL.test(name) ? placeName(subPath) : place);
      } else if (asMeta(e)?.["*"] !== undefined) {
        shape.choices.push({ path: join(path, String(i)), place });
      }
    }
    if (meta) {
      for (const [key, value] of Object.entries(meta)) {
        const child = asArray(value);
        if (key.startsWith("#") || !child || key === "global decl") continue;
        const subPath = join(path, key);
        const authored = !INTERNAL.test(key);
        if (path === "" && returns(child)) shape.functions.add(key);
        if (isCounted(asMeta(child[child.length - 1])) && authored) shape.places.push({ path: subPath, name: placeName(subPath) });
        walk(child, subPath, authored ? placeName(subPath) : place);
      }
    }
  };

  const root = asArray(asMeta(json)?.root);
  if (root) walk(root, "", "");
  // Functions are code, not places: drop them and everything inside them.
  shape.places = shape.places.filter((p) => !shape.functions.has(p.path.split(".")[0]));

  // A variable matters when it is read for control, or feeds one that is.
  const relevant = new Set(reads);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [x, ys] of feeds) {
      if (relevant.has(x)) continue;
      for (const y of ys) {
        if (relevant.has(y)) {
          relevant.add(x);
          grew = true;
          break;
        }
      }
    }
  }
  shape.relevant = relevant;
  return shape;
}

function join(path: string, comp: string): string {
  return path === "" ? comp : `${path}.${comp}`;
}
