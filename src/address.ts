import { DurableObject } from "cloudflare:workers";

/** Send at most one verification email per address per day. */
export const VERIFICATION_RESEND_MS = 24 * 60 * 60 * 1000;
/** Send at most one sign-in email per address per two minutes. */
export const SIGN_IN_RESEND_MS = 2 * 60 * 1000;

export type AddressState =
  | { status: "unknown" }
  | { status: "pending"; firstSeen: string; pending: PendingMail[] }
  | { status: "verified"; householdId: string; verifiedAt: string; pending: PendingMail[] };

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
        verified_at TEXT,
        verification_sent_at TEXT,
        sign_in_sent_at TEXT
      );
      CREATE TABLE IF NOT EXISTS pending (
        key TEXT PRIMARY KEY,
        received_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    // Migration: addresses first seen before verification emails existed lack this column.
    const columns = this.sql
      .exec<{ name: string }>("SELECT name FROM pragma_table_info('address')")
      .toArray()
      .map((c) => c.name);
    if (!columns.includes("verification_sent_at")) {
      this.sql.exec("ALTER TABLE address ADD COLUMN verification_sent_at TEXT");
    }
    if (!columns.includes("sign_in_sent_at")) {
      this.sql.exec("ALTER TABLE address ADD COLUMN sign_in_sent_at TEXT");
    }
  }

  lookup(): AddressState {
    const row = this.sql
      .exec<{ first_seen: string; household_id: string | null; verified_at: string | null }>(
        "SELECT first_seen, household_id, verified_at FROM address WHERE id = 1",
      )
      .toArray()[0];
    if (row === undefined) return { status: "unknown" };
    const pending = this.sql
      .exec<{ key: string; received_at: string; expires_at: string }>(
        "SELECT key, received_at, expires_at FROM pending ORDER BY received_at, key",
      )
      .toArray()
      .map((p) => ({ key: p.key, receivedAt: p.received_at, expiresAt: p.expires_at }));
    if (row.household_id !== null && row.verified_at !== null) {
      // `pending` is normally empty here; it's non-empty only if moving held mail was interrupted.
      return {
        status: "verified",
        householdId: row.household_id,
        verifiedAt: row.verified_at,
        pending,
      };
    }
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

  /**
   * Whether to send a verification email now. True at most once per VERIFICATION_RESEND_MS,
   * and never for a verified address. Records the send time when it returns true.
   */
  claimVerificationSend(now: string): boolean {
    const row = this.sql
      .exec<{ household_id: string | null; verification_sent_at: string | null }>(
        "SELECT household_id, verification_sent_at FROM address WHERE id = 1",
      )
      .toArray()[0];
    if (row?.household_id !== null) return false;
    const last = row.verification_sent_at === null ? null : Date.parse(row.verification_sent_at);
    if (last !== null && Date.parse(now) - last < VERIFICATION_RESEND_MS) return false;
    this.sql.exec("UPDATE address SET verification_sent_at = ? WHERE id = 1", now);
    return true;
  }

  /**
   * Whether to send a sign-in email now: only to verified addresses, and at most once per
   * SIGN_IN_RESEND_MS. Records the send time when it returns true.
   */
  claimSignInSend(now: string): boolean {
    const row = this.sql
      .exec<{ household_id: string | null; sign_in_sent_at: string | null }>(
        "SELECT household_id, sign_in_sent_at FROM address WHERE id = 1",
      )
      .toArray()[0];
    if (row?.household_id == null) return false;
    const last = row.sign_in_sent_at === null ? null : Date.parse(row.sign_in_sent_at);
    if (last !== null && Date.parse(now) - last < SIGN_IN_RESEND_MS) return false;
    this.sql.exec("UPDATE address SET sign_in_sent_at = ? WHERE id = 1", now);
    return true;
  }

  /** Forgets a held message once it has moved to the household (or expired). */
  removePending(key: string): void {
    this.sql.exec("DELETE FROM pending WHERE key = ?", key);
  }

  /** Marks the address as verified and part of a household. */
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
