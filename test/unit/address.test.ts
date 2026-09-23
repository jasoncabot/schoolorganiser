import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Address } from "../../src/address";

describe("Address migrations", () => {
  it("adds verification_sent_at to addresses stored before it existed", async () => {
    const stub = env.ADDRESS.getByName("migration-test@example.com");
    const result = await runInDurableObject(stub, (_instance, state) => {
      // Recreate the original (plan step 3) layout with a held message.
      state.storage.sql.exec(`
        DROP TABLE IF EXISTS address;
        CREATE TABLE address (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          first_seen TEXT NOT NULL,
          household_id TEXT,
          verified_at TEXT
        );
        INSERT INTO address (id, first_seen) VALUES (1, '2025-10-06T08:00:00.000Z');
      `);
      const upgraded = new Address(state, env);
      return {
        first: upgraded.claimVerificationSend("2025-10-06T09:00:00.000Z"),
        again: upgraded.claimVerificationSend("2025-10-06T10:00:00.000Z"),
        state: upgraded.lookup(),
      };
    });
    expect(result).toEqual({
      first: true,
      again: false,
      state: { status: "pending", firstSeen: "2025-10-06T08:00:00.000Z", pending: [] },
    });
  });
});
