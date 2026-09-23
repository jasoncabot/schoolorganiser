// Everything non-deterministic goes through here, so tests can pin it (see docs/testing.md).
// This is the only file in src/ allowed to read the real clock or randomness.

export interface Clock {
  now(): Date;
}

export interface Random {
  /** Cryptographically strong random bytes. */
  bytes(length: number): Uint8Array;
}

export interface Ids {
  /** A new unique ID, e.g. for a household or message. */
  next(): string;
}

export interface Deps {
  clock: Clock;
  random: Random;
  ids: Ids;
}

export const systemDeps: Deps = {
  clock: { now: () => new Date() },
  random: { bytes: (length) => crypto.getRandomValues(new Uint8Array(length)) },
  ids: { next: () => crypto.randomUUID() },
};
