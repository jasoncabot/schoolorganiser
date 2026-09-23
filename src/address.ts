import { DurableObject } from "cloudflare:workers";

export type AddressState =
  | { status: "unknown" }
  | { status: "pending"; firstSeen: string; pending: PendingMail[] }
  | { status: "verified"; householdId: string; verifiedAt: string };

export interface PendingMail {
  key: string;
  receivedAt: string;
  expiresAt: string;
}

/**
 * One per normalised email address (`getByName(address)`).
 * Maps the address to its household and holds mail that arrived before it was verified.
 */
export class Address extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS address (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        first_seen TEXT NOT NULL,
        household_id TEXT,
        verified_at TEXT
      );
      CREATE TABLE IF NOT EXISTS pending (
        key TEXT PRIMARY KEY,
        received_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  }

  lookup(): AddressState {
    const row = this.sql
      .exec<{ first_seen: string; household_id: string | null; verified_at: string | null }>(
        "SELECT first_seen, household_id, verified_at FROM address WHERE id = 1",
      )
      .toArray()[0];
    if (row === undefined) return { status: "unknown" };
    if (row.household_id !== null && row.verified_at !== null) {
      return { status: "verified", householdId: row.household_id, verifiedAt: row.verified_at };
    }
    const pending = this.sql
      .exec<{ key: string; received_at: string; expires_at: string }>(
        "SELECT key, received_at, expires_at FROM pending ORDER BY received_at, key",
      )
      .toArray()
      .map((p) => ({ key: p.key, receivedAt: p.received_at, expiresAt: p.expires_at }));
    return { status: "pending", firstSeen: row.first_seen, pending };
  }

  /** Records mail held until this address is verified. */
  holdPending(mail: PendingMail): AddressState {
    this.sql.exec("INSERT OR IGNORE INTO address (id, first_seen) VALUES (1, ?)", mail.receivedAt);
    this.sql.exec(
      "INSERT OR IGNORE INTO pending (key, received_at, expires_at) VALUES (?, ?, ?)",
      mail.key,
      mail.receivedAt,
      mail.expiresAt,
    );
    return this.lookup();
  }

  /** Marks the address as verified and part of a household. Used by verification (plan step 4). */
  link(householdId: string, verifiedAt: string): AddressState {
    this.sql.exec(
      `INSERT INTO address (id, first_seen, household_id, verified_at) VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET household_id = excluded.household_id, verified_at = excluded.verified_at`,
      verifiedAt,
      householdId,
      verifiedAt,
    );
    return this.lookup();
  }
}
