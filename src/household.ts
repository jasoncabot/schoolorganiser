import { Agent } from "agents";
import type { Child, ChildInput } from "./children";
import { systemDeps, type Deps } from "./deps";
import { runModel } from "./extract/ai";
import { readMessage, type Unreadable } from "./extract/message";
import { parseExtraction } from "./extract/parse";
import { pdfRenderer } from "./extract/render";
import {
  EXTRACTION_MODEL,
  EXTRACTION_VERSION,
  extractionRequest,
  type ExtractedItem,
} from "./extract/prompt";
import { addDays, MAIL_DAYS } from "./retention";

export interface ReceivedMail {
  id: string;
  key: string;
  receivedAt: string;
  expiresAt: string;
}

export type MessageStatus = "new" | "done" | "failed";

export interface StoredItem extends ExtractedItem {
  id: string;
  messageId: string;
  expiresAt: string;
}

/** Attempts at processing one message before it's marked failed. */
export const MAX_ATTEMPTS = 3;
/** Wait between attempts after a transient failure (e.g. Workers AI unavailable). */
const RETRY_SECONDS = 5 * 60;

/**
 * One per household. Holds members, messages, extracted items and (later) children, schools and
 * digest history. Retention alarms arrive in plan step 6.
 */
export class Household extends Agent<Env> {
  private schemaReady = false;

  private get db(): SqlStorage {
    if (!this.schemaReady) {
      migrate(this.ctx.storage.sql);
      this.schemaReady = true;
    }
    return this.ctx.storage.sql;
  }

  /** Records a message stored in R2 for this household and queues it for processing. */
  async receive(mail: ReceivedMail): Promise<void> {
    this.db.exec(
      "INSERT OR IGNORE INTO messages (id, r2_key, received_at, expires_at) VALUES (?, ?, ?, ?)",
      mail.id,
      mail.key,
      mail.receivedAt,
      mail.expiresAt,
    );
    // Tests turn this off and call processPending() with test deps instead.
    if (this.env.PROCESS_ON_RECEIVE !== "0") {
      await this.schedule(0, "processScheduled", undefined, { idempotent: true });
    }
  }

  /** Scheduled callback: processes waiting messages with the real clock. */
  async processScheduled(): Promise<void> {
    const { retry } = await this.processPending(systemDeps);
    if (retry)
      await this.schedule(RETRY_SECONDS, "processScheduled", undefined, { idempotent: true });
  }

  /**
   * Reads and extracts every message still waiting. Returns whether any should be tried again
   * later. Never logs content or addresses: only counts and outcomes.
   */
  async processPending(deps: Deps): Promise<{ processed: number; retry: boolean }> {
    const waiting = this.db
      .exec<{ id: string; r2_key: string; received_at: string; attempts: number }>(
        `SELECT id, r2_key, received_at, attempts FROM messages
         WHERE status = 'new' OR (status = 'done' AND extraction_version < ?)
         ORDER BY received_at, id`,
        EXTRACTION_VERSION,
      )
      .toArray();
    let retry = false;
    for (const message of waiting) {
      try {
        await this.processMessage(message.id, message.r2_key, message.received_at, deps);
      } catch (error) {
        const attempts = message.attempts + 1;
        const status: MessageStatus = attempts >= MAX_ATTEMPTS ? "failed" : "new";
        this.db.exec(
          "UPDATE messages SET attempts = ?, status = ? WHERE id = ?",
          attempts,
          status,
          message.id,
        );
        retry ||= status === "new";
        console.error("processing failed", { attempts, status, error: errorName(error) });
      }
    }
    return { processed: waiting.length, retry };
  }

  private async processMessage(
    id: string,
    key: string,
    receivedAt: string,
    deps: Deps,
  ): Promise<void> {
    const object = await this.env.MAIL.get(key);
    if (object === null) {
      // Gone (expired or deleted): nothing to process.
      this.db.exec("UPDATE messages SET status = 'failed' WHERE id = ?", id);
      return;
    }
    const message = await readMessage(
      await object.arrayBuffer(),
      this.env.AI,
      pdfRenderer(this.env),
    );
    const sentAt = message.sentAt ?? receivedAt;
    let items: ExtractedItem[] = [];
    if (message.text.trim() !== "" || message.images.length > 0) {
      const result = await runModel(
        this.env.AI,
        EXTRACTION_MODEL,
        extractionRequest({
          sentAt,
          subject: message.subject,
          text: message.text,
          images: message.images,
        }),
      );
      const parsed = parseExtraction(result, sentAt);
      if (parsed === null) throw new Error("UnusableExtraction");
      items = parsed;
    }
    this.store(id, sentAt, message.subject, message.text, message.unreadable, items, deps);
    console.log("message processed", {
      items: items.length,
      unreadable: message.unreadable.length,
      chars: message.text.length,
      pages: message.images.length,
    });
  }

  private store(
    id: string,
    sentAt: string,
    subject: string,
    text: string,
    unreadable: Unreadable[],
    items: ExtractedItem[],
    deps: Deps,
  ): void {
    this.ctx.storage.transactionSync(() => {
      this.db.exec("DELETE FROM items WHERE message_id = ?", id);
      this.db.exec("DELETE FROM unreadable WHERE message_id = ?", id);
      items.forEach((item, index) => {
        this.db.exec(
          `INSERT INTO items (id, message_id, date, time, kind, title, cost, location, school, child, confidence, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `${id}-${String(index)}`,
          id,
          item.date,
          item.time,
          item.kind,
          item.title,
          item.cost,
          item.location,
          item.school,
          item.child,
          item.confidence,
          addDays(new Date(`${item.date}T00:00:00.000Z`), MAIL_DAYS).toISOString(),
        );
      });
      for (const file of unreadable) {
        this.db.exec(
          "INSERT INTO unreadable (message_id, filename, reason) VALUES (?, ?, ?)",
          id,
          file.filename,
          file.reason,
        );
      }
      this.db.exec(
        `UPDATE messages SET status = 'done', subject = ?, sent_at = ?, body_text = ?, processed_at = ?,
           extraction_version = ?, attempts = 0
         WHERE id = ?`,
        subject,
        sentAt,
        text,
        deps.clock.now().toISOString(),
        EXTRACTION_VERSION,
        id,
      );
    });
  }

  /** Children, oldest entry first. */
  children(): Child[] {
    return this.db
      .exec<{
        id: string;
        name: string;
        school: string;
        year_group: number;
        year_group_as_of: number;
        class_name: string | null;
      }>(
        "SELECT id, name, school, year_group, year_group_as_of, class_name FROM children ORDER BY created_at, id",
      )
      .toArray()
      .map((c) => ({
        id: c.id,
        name: c.name,
        school: c.school,
        yearGroup: c.year_group,
        yearGroupAsOf: c.year_group_as_of,
        className: c.class_name,
      }));
  }

  /** Adds a child. `schoolYear` is the school year the year group applies to (see children.ts). */
  addChild(id: string, input: ChildInput, schoolYear: number, now: string): void {
    this.db.exec(
      `INSERT INTO children (id, name, school, year_group, year_group_as_of, class_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.school,
      input.yearGroup,
      schoolYear,
      input.className,
      now,
    );
    this.childrenChanged();
  }

  /** Replaces a child's details. Returns false if there's no such child. */
  updateChild(id: string, input: ChildInput, schoolYear: number): boolean {
    const changed = this.db.exec(
      `UPDATE children SET name = ?, school = ?, year_group = ?, year_group_as_of = ?, class_name = ?
       WHERE id = ?`,
      input.name,
      input.school,
      input.yearGroup,
      schoolYear,
      input.className,
      id,
    ).rowsWritten;
    if (changed > 0) this.childrenChanged();
    return changed > 0;
  }

  removeChild(id: string): boolean {
    const removed = this.db.exec("DELETE FROM children WHERE id = ?", id).rowsWritten;
    if (removed > 0) this.childrenChanged();
    return removed > 0;
  }

  /** Increases whenever children change, so stored mail can be re-read for relevance. */
  childrenVersion(): number {
    return (
      this.db
        .exec<{ value: number }>("SELECT value FROM meta WHERE key = 'children_version'")
        .toArray()[0]?.value ?? 0
    );
  }

  private childrenChanged(): void {
    this.db.exec(
      `INSERT INTO meta (key, value) VALUES ('children_version', 1)
       ON CONFLICT (key) DO UPDATE SET value = value + 1`,
    );
  }

  /** Adds a verified address to the household. Digests go to every member. */
  addMember(address: string, joinedAt: string): void {
    this.db.exec(
      "INSERT OR IGNORE INTO members (address, joined_at) VALUES (?, ?)",
      address,
      joinedAt,
    );
  }

  members(): { address: string; joinedAt: string }[] {
    return this.db
      .exec<{ address: string; joined_at: string }>(
        "SELECT address, joined_at FROM members ORDER BY joined_at, address",
      )
      .toArray()
      .map((m) => ({ address: m.address, joinedAt: m.joined_at }));
  }

  messages(): (ReceivedMail & {
    status: MessageStatus;
    subject: string | null;
    attempts: number;
  })[] {
    return this.db
      .exec<{
        id: string;
        r2_key: string;
        received_at: string;
        expires_at: string;
        status: MessageStatus;
        subject: string | null;
        attempts: number;
      }>(
        "SELECT id, r2_key, received_at, expires_at, status, subject, attempts FROM messages ORDER BY received_at, id",
      )
      .toArray()
      .map((m) => ({
        id: m.id,
        key: m.r2_key,
        receivedAt: m.received_at,
        expiresAt: m.expires_at,
        status: m.status,
        subject: m.subject,
        attempts: m.attempts,
      }));
  }

  items(): StoredItem[] {
    return this.db
      .exec<{
        id: string;
        message_id: string;
        date: string;
        time: string | null;
        kind: StoredItem["kind"];
        title: string;
        cost: string | null;
        location: string | null;
        school: string | null;
        child: string | null;
        confidence: StoredItem["confidence"];
        expires_at: string;
      }>("SELECT * FROM items ORDER BY date, time, id")
      .toArray()
      .map((i) => ({
        id: i.id,
        messageId: i.message_id,
        date: i.date,
        time: i.time,
        kind: i.kind,
        title: i.title,
        cost: i.cost,
        location: i.location,
        school: i.school,
        child: i.child,
        confidence: i.confidence,
        expiresAt: i.expires_at,
      }));
  }

  unreadable(): (Unreadable & { messageId: string })[] {
    return this.db
      .exec<{ message_id: string; filename: string; reason: Unreadable["reason"] }>(
        "SELECT message_id, filename, reason FROM unreadable ORDER BY message_id, filename",
      )
      .toArray()
      .map((u) => ({ messageId: u.message_id, filename: u.filename, reason: u.reason }));
  }
}

/** Creates or upgrades the household's tables. Safe to run on every start. */
export function migrate(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      r2_key TEXT NOT NULL,
      received_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      address TEXT PRIMARY KEY,
      joined_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      cost TEXT,
      location TEXT,
      school TEXT,
      child TEXT,
      confidence TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS items_by_date ON items (date);
    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      school TEXT NOT NULL,
      year_group INTEGER NOT NULL,
      year_group_as_of INTEGER NOT NULL,
      class_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS unreadable (
      message_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      reason TEXT NOT NULL,
      mentioned_at TEXT
    );
  `);
  // Messages stored before processing existed (plan steps 3 and 4) lack these columns.
  const columns = new Set(
    sql
      .exec<{ name: string }>("SELECT name FROM pragma_table_info('messages')")
      .toArray()
      .map((c) => c.name),
  );
  const added: [string, string][] = [
    ["status", "TEXT NOT NULL DEFAULT 'new'"],
    ["attempts", "INTEGER NOT NULL DEFAULT 0"],
    ["subject", "TEXT"],
    ["sent_at", "TEXT"],
    ["body_text", "TEXT"],
    ["processed_at", "TEXT"],
    // Messages processed before versioning count as version 1.
    ["extraction_version", "INTEGER NOT NULL DEFAULT 1"],
  ];
  for (const [name, definition] of added) {
    if (!columns.has(name)) sql.exec(`ALTER TABLE messages ADD COLUMN ${name} ${definition}`);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 80) : "unknown";
}
