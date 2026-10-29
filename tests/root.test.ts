import { describe, expect, test } from "vitest";
import { LatestOnly, applyVaultEvent, isDependency, nextRoot, resolveRoot } from "../src/root";

describe("resolveRoot", () => {
  test("uses the active .ink file when nothing is locked", () => {
    expect(resolveRoot("a.ink", null)).toBe("a.ink");
  });
  test("ignores non-ink files", () => {
    expect(resolveRoot("a.md", null)).toBeNull();
  });
  test("the locked file wins over the active file", () => {
    expect(resolveRoot("sub.ink", "main.ink")).toBe("main.ink");
  });
  test("nothing active, nothing locked", () => {
    expect(resolveRoot(null, null)).toBeNull();
  });
});

describe("isDependency", () => {
  test("matches only listed files", () => {
    expect(isDependency("a.ink", ["main.ink", "a.ink"])).toBe(true);
    expect(isDependency("x.ink", ["main.ink", "a.ink"])).toBe(false);
  });
});

describe("applyVaultEvent", () => {
  test("deleting the locked file clears the lock", () => {
    expect(applyVaultEvent("main.ink", { type: "delete", path: "main.ink" })).toBeNull();
  });
  test("renaming the locked file follows it", () => {
    expect(applyVaultEvent("main.ink", { type: "rename", path: "main.ink", newPath: "new.ink" })).toBe("new.ink");
  });
  test("unrelated events leave the lock alone", () => {
    expect(applyVaultEvent("main.ink", { type: "delete", path: "other.ink" })).toBe("main.ink");
    expect(applyVaultEvent(null, { type: "delete", path: "other.ink" })).toBeNull();
  });
});

describe("LatestOnly", () => {
  test("a superseded run returns null, the newest returns its value", async () => {
    const l = new LatestOnly();
    const slow = l.run(() => new Promise<string>((r) => setTimeout(() => r("old"), 30)));
    const fast = l.run(async () => "new");
    expect(await fast).toBe("new");
    expect(await slow).toBeNull();
  });
  test("a lone run returns its value", async () => {
    expect(await new LatestOnly().run(async () => 1)).toBe(1);
  });
});

describe("nextRoot", () => {
  test("switching to a non-ink file keeps the current story", () => {
    expect(nextRoot("main.ink", "note.md", null)).toBe("main.ink");
  });
  test("focus moving to a non-file leaf keeps the current story", () => {
    expect(nextRoot("main.ink", null, null)).toBe("main.ink");
  });
  test("opening another ink file switches to it", () => {
    expect(nextRoot("main.ink", "other.ink", null)).toBe("other.ink");
  });
  test("a lock always wins", () => {
    expect(nextRoot("other.ink", "x.ink", "main.ink")).toBe("main.ink");
  });
});

describe("LatestOnly.invalidate", () => {
  test("invalidate discards an in-flight run", async () => {
    const l = new LatestOnly();
    const p = l.run(() => new Promise<string>((r) => setTimeout(() => r("old"), 20)));
    l.invalidate();
    expect(await p).toBeNull();
  });
});
