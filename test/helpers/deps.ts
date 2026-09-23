import type { Clock, Deps } from "../../src/deps";

/** The default "now" for tests: Monday 6 October 2025, 09:00 UK time (BST). */
export const DEFAULT_NOW = "2025-10-06T08:00:00.000Z";

export interface TestClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

export function fixedClock(iso: string = DEFAULT_NOW): TestClock {
  let now = Date.parse(iso);
  if (Number.isNaN(now)) throw new Error(`Invalid date: ${iso}`);
  return {
    now: () => new Date(now),
    set: (next) => (now = Date.parse(next)),
    advance: (ms) => (now += ms),
  };
}

/** A small seeded generator (mulberry32). Same seed, same sequence, every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Stable 32-bit seed from a string, e.g. the test's name (FNV-1a). */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface TestDeps extends Deps {
  clock: TestClock;
}

/**
 * Deterministic deps for one test. Pass the test's name (`expect.getState().currentTestName`
 * or a literal) so each test has its own seed and concurrent tests never share state.
 */
export function testDeps(name: string, now: string = DEFAULT_NOW): TestDeps {
  const seed = seedFrom(name);
  const next = mulberry32(seed);
  let counter = 0;
  const prefix = seed.toString(16).padStart(8, "0");
  return {
    clock: fixedClock(now),
    random: {
      bytes: (length) => Uint8Array.from({ length }, () => next() & 0xff),
    },
    ids: { next: () => `${prefix}-${String(++counter).padStart(4, "0")}` },
  };
}
