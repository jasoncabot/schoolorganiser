import { describe, expect, it } from "vitest";
import { fixedClock, seedFrom, testDeps } from "../helpers/deps";

describe("test deps", () => {
  it("gives the same ids and bytes for the same name", () => {
    const a = testDeps("household A");
    const b = testDeps("household A");
    expect([a.ids.next(), a.ids.next()]).toEqual([b.ids.next(), b.ids.next()]);
    expect(a.random.bytes(16)).toEqual(b.random.bytes(16));
  });

  it("gives different ids for different names", () => {
    expect(testDeps("one").ids.next()).not.toEqual(testDeps("two").ids.next());
  });

  it("produces ids that are stable across runs", () => {
    const deps = testDeps("stable");
    expect(seedFrom("stable")).toMatchInlineSnapshot(`3164387478`);
    expect([deps.ids.next(), deps.ids.next()]).toMatchInlineSnapshot(`
      [
        "bc9cb896-0001",
        "bc9cb896-0002",
      ]
    `);
  });

  it("only moves the clock when told to", () => {
    const clock = fixedClock("2026-03-29T00:30:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-03-29T00:30:00.000Z");
    clock.advance(60 * 60 * 1000);
    expect(clock.now().toISOString()).toBe("2026-03-29T01:30:00.000Z");
    clock.set("2026-10-25T01:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-10-25T01:00:00.000Z");
  });
});
