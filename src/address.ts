import { DurableObject } from "cloudflare:workers";
import { systemDeps } from "./deps";
import { purgeTime } from "./retention";
import { addMissingColumns } from "./sql";

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
  private schemaReady = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Mail held before retention existed has no alarm yet; set one if it needs it.
    void ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) await this.armPurge();
    });
  }

  /** The address's storage, creating or upgrading its tables first if needed. */
  private get sql(): SqlStorage {
    if (!this.schemaReady) {
      this.migrate();
      this.schemaReady = true;
    }
    return this.ctx.storage.sql;
  }

  private migrate(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`
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
    // Columns added after the first addresses were stored.
    addMissingColumns(sql, "address", { verification_sent_at: "TEXT", sign_in_sent_at: "TEXT" });
  }

  /** Alarm: deletes expired held mail by the real clock. */
  override async alarm(): Promise<void> {
    await this.purge(systemDeps.clock.now());
  }

  /**
   * Deletes held mail (and its R2 original) once it's PENDING_DAYS old. An address that never
   * verified and has nothing left held is forgotten entirely, including the address itself.
   * Otherwise the alarm is re-armed for the next expiry.
   */
  async purge(now: Date): Promise<{ deleted: number; forgotten: boolean }> {
    const expired = this.sql
      .exec<{ key: string }>("SELECT key FROM pending WHERE expires_at <= ?", now.toISOString())
      .toArray();
    for (const { key } of expired) {
      await this.env.MAIL.delete(key);
      this.sql.exec("DELETE FROM pending WHERE key = ?", key);
    }
    const state = this.lookup();
    if (state.status === "unknown" || (state.status === "pending" && state.pending.length === 0)) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.schemaReady = false;
      return { deleted: expired.length, forgotten: true };
    }
    await this.armPurge(true);
    return { deleted: expired.length, forgotten: false };
  }

  /** Forgets the address and deletes any mail held for it: on deleting data or leaving a household. */
  async forget(): Promise<void> {
    const held = this.sql.exec<{ key: string }>("SELECT key FROM pending").toArray();
    if (held.length > 0) await this.env.MAIL.delete(held.map((h) => h.key));
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.schemaReady = false;
  }

  /** When a purge should next run (the earliest held-mail expiry, rounded up to midnight), or null. */
  purgeDue(): string | null {
    const next = this.sql
      .exec<{ next: string | null }>("SELECT MIN(expires_at) AS next FROM pending")
      .one().next;
    return next === null ? null : purgeTime(next).toISOString();
  }

  /**
   * Sets the alarm for purgeDue(). Only moves it earlier, unless `replace` (after a purge, when
   * the current alarm has just fired). No alarm when SCHEDULED_WORK is "0" (tests).
   */
  private async armPurge(replace = false): Promise<void> {
    if (this.env.SCHEDULED_WORK === "0") return;
    const due = this.purgeDue();
    if (due === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const dueMs = Date.parse(due);
    const current = await this.ctx.storage.getAlarm();
    if (replace || current === null || dueMs < current) await this.ctx.storage.setAlarm(dueMs);
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

  /** Records mail held until this address is verified, and makes sure it will expire. */
  async holdPending(mail: PendingMail): Promise<AddressState> {
    this.sql.exec("INSERT OR IGNORE INTO address (id, first_seen) VALUES (1, ?)", mail.receivedAt);
    this.sql.exec(
      "INSERT OR IGNORE INTO pending (key, received_at, expires_at) VALUES (?, ?, ?)",
      mail.key,
      mail.receivedAt,
      mail.expiresAt,
    );
    await this.armPurge();
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
