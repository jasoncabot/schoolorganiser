import { Agent } from "agents";

export interface ReceivedMail {
  id: string;
  key: string;
  receivedAt: string;
  expiresAt: string;
}

/**
 * One per household. Holds members, children, schools, messages, items and digest history.
 * Processing arrives in plan step 5 and retention alarms in step 6.
 */
export class Household extends Agent<Env> {
  private schemaReady = false;

  private get db(): SqlStorage {
    if (!this.schemaReady) {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        r2_key TEXT NOT NULL,
        received_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`);
      this.schemaReady = true;
    }
    return this.ctx.storage.sql;
  }

  /** Records a message stored in R2 for this household. */
  receive(mail: ReceivedMail): void {
    this.db.exec(
      "INSERT OR IGNORE INTO messages (id, r2_key, received_at, expires_at) VALUES (?, ?, ?, ?)",
      mail.id,
      mail.key,
      mail.receivedAt,
      mail.expiresAt,
    );
  }

  messages(): ReceivedMail[] {
    return this.db
      .exec<{ id: string; r2_key: string; received_at: string; expires_at: string }>(
        "SELECT id, r2_key, received_at, expires_at FROM messages ORDER BY received_at, id",
      )
      .toArray()
      .map((m) => ({
        id: m.id,
        key: m.r2_key,
        receivedAt: m.received_at,
        expiresAt: m.expires_at,
      }));
  }
}
