import { Agent } from "agents";
import { currentYearGroup, yearGroupLabel, type Child, type ChildInput } from "./children";
import { systemDeps, type Deps } from "./deps";
import { runModel } from "./extract/ai";
import { readMessage, type Unreadable } from "./extract/message";
import { parseExtraction } from "./extract/parse";
import { relevance } from "./extract/relevance";
import { pdfRenderer } from "./extract/render";
import {
  EXTRACTION_MODEL,
  EXTRACTION_VERSION,
  extractionRequest,
  type ExtractedItem,
} from "./extract/prompt";
import { migrate } from "./household-schema";
import { addDays, MAIL_DAYS, purgeTime } from "./retention";

export { migrate };

export interface ReceivedMail {
  id: string;
  key: string;
  receivedAt: string;
  expiresAt: string;
}

export type MessageStatus = "new" | "done" | "failed";

export interface StoredItem extends Omit<ExtractedItem, "forChildren" | "maybeChildren"> {
  id: string;
  messageId: string;
  expiresAt: string;
  /**
   * The household's children this item is for (ids), or null if the household had no children
   * set up when it was read, in which case it counts as relevant to everyone.
   */
  childIds: string[] | null;
  /** Children it may apply to (e.g. an unknown class name at their school). */
  maybeChildIds: string[];
}

/** Attempts at processing one message before it's marked failed. */
export const MAX_ATTEMPTS = 3;
/** Wait after children change before re-reading stored mail. */
const REREAD_DELAY_SECONDS = 60;
/** Wait between attempts after a transient failure (e.g. Workers AI unavailable). */
const RETRY_SECONDS = 5 * 60;

/** One per household: members, children, messages, extracted items and their retention. */
export class Household extends Agent<Env> {
  private schemaReady = false;

  /** Arms the purge on start, so data stored before it existed is covered. */
  override async onStart(): Promise<void> {
    await this.armPurge();
  }

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
    await this.armPurge();
    if (this.env.SCHEDULED_WORK !== "0") {
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
         WHERE status = 'new'
            OR (status = 'done' AND (extraction_version < ? OR children_version < ?))
         ORDER BY received_at, id`,
        EXTRACTION_VERSION,
        this.childrenVersion(),
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
    if (waiting.length > 0) await this.armPurge();
    return { processed: waiting.length, retry };
  }

  /**
   * Scheduled callback: deletes whatever has expired, by the real clock. The SDK passes the
   * running schedule, which is still listed until this returns, so re-arming must ignore it.
   */
  async purgeScheduled(_payload: unknown, running?: { id: string }): Promise<void> {
    await this.purgeExpired(systemDeps.clock.now(), running?.id);
  }

  /**
   * Deletes expired data (see docs/privacy.md): messages 90 days after receipt, with their text,
   * unreadable-file notes and original in R2; items 90 days after their date. Then re-arms the
   * purge for the next expiry. Never logs content: only counts.
   */
  async purgeExpired(
    now: Date,
    runningScheduleId?: string,
  ): Promise<{ messages: number; items: number }> {
    const cutoff = now.toISOString();
    const expired = this.db
      .exec<{ id: string; r2_key: string }>(
        "SELECT id, r2_key FROM messages WHERE expires_at <= ?",
        cutoff,
      )
      .toArray();
    for (const message of expired) {
      await this.env.MAIL.delete(message.r2_key);
      this.db.exec("DELETE FROM unreadable WHERE message_id = ?", message.id);
      this.db.exec("DELETE FROM messages WHERE id = ?", message.id);
    }
    const items = this.db.exec("DELETE FROM items WHERE expires_at <= ?", cutoff).rowsWritten;
    await this.armPurge(runningScheduleId);
    if (expired.length > 0 || items > 0) console.log("purged", { messages: expired.length, items });
    return { messages: expired.length, items };
  }

  /** When a purge should next run (the earliest expiry, rounded up to midnight), or null. */
  purgeDue(): string | null {
    const next = this.db
      .exec<{ next: string | null }>(
        "SELECT MIN(expires_at) AS next FROM (SELECT expires_at FROM messages UNION ALL SELECT expires_at FROM items)",
      )
      .one().next;
    return next === null ? null : purgeTime(next).toISOString();
  }

  /**
   * Keeps exactly one purge scheduled, for purgeDue(). It only ever moves earlier: a purge that
   * fires early finds nothing (or less) to delete and re-arms for the next expiry. Nothing is
   * scheduled when SCHEDULED_WORK is "0" (tests).
   */
  private async armPurge(runningScheduleId?: string): Promise<void> {
    if (this.env.SCHEDULED_WORK === "0") return;
    const due = this.purgeDue();
    const existing = (await this.listSchedules()).filter(
      (s) => s.callback === "purgeScheduled" && s.id !== runningScheduleId,
    );
    if (due === null) {
      for (const schedule of existing) await this.cancelSchedule(schedule.id);
      return;
    }
    const dueMs = Date.parse(due);
    if (existing.some((s) => s.time * 1000 <= dueMs)) return;
    for (const schedule of existing) await this.cancelSchedule(schedule.id);
    await this.schedule(new Date(dueMs), "purgeScheduled");
  }

  private async processMessage(
    id: string,
    key: string,
    receivedAt: string,
    deps: Deps,
  ): Promise<void> {
    const object = await this.env.MAIL.get(key);
    if (object === null) {
      this.db.exec("UPDATE messages SET status = 'failed' WHERE id = ?", id);
      return;
    }
    const message = await readMessage(
      await object.arrayBuffer(),
      this.env.AI,
      pdfRenderer(this.env, deps),
    );
    const sentAt = message.sentAt ?? receivedAt;
    const childrenVersion = this.childrenVersion();
    const now = deps.clock.now();
    // Children who've left school can't be the subject of a school letter.
    const children = this.children().filter((c) => currentYearGroup(c, now) !== null);
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
          children: children.map((c) => ({
            name: c.name,
            school: c.school,
            yearGroup: yearGroupLabel(currentYearGroup(c, now)),
            className: c.className,
          })),
        }),
      );
      const parsed = parseExtraction(result, sentAt);
      if (parsed === null) throw new Error("UnusableExtraction");
      items = parsed;
    }
    this.store(id, {
      sentAt,
      subject: message.subject,
      text: message.text,
      unreadable: message.unreadable,
      items,
      children,
      childrenVersion,
      processedAt: now.toISOString(),
    });
    console.log("message processed", {
      items: items.length,
      unreadable: message.unreadable.length,
      chars: message.text.length,
      pages: message.images.length,
    });
  }

  private store(
    id: string,
    read: {
      sentAt: string;
      subject: string;
      text: string;
      unreadable: Unreadable[];
      items: ExtractedItem[];
      children: Child[];
      childrenVersion: number;
      processedAt: string;
    },
  ): void {
    this.ctx.storage.transactionSync(() => {
      this.db.exec("DELETE FROM items WHERE message_id = ?", id);
      this.db.exec("DELETE FROM unreadable WHERE message_id = ?", id);
      read.items.forEach((item, index) => {
        const { childIds, maybeChildIds } = relevance(item, read.children);
        this.db.exec(
          `INSERT INTO items (id, message_id, date, time, kind, title, cost, location, school, child, confidence, expires_at, child_ids, maybe_child_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          childIds === null ? null : JSON.stringify(childIds),
          JSON.stringify(maybeChildIds),
        );
      });
      for (const file of read.unreadable) {
        this.db.exec(
          "INSERT INTO unreadable (message_id, filename, reason) VALUES (?, ?, ?)",
          id,
          file.filename,
          file.reason,
        );
      }
      this.db.exec(
        `UPDATE messages SET status = 'done', subject = ?, sent_at = ?, body_text = ?, processed_at = ?,
           extraction_version = ?, children_version = ?, attempts = 0
         WHERE id = ?`,
        read.subject,
        read.sentAt,
        read.text,
        read.processedAt,
        EXTRACTION_VERSION,
        read.childrenVersion,
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
  async addChild(id: string, input: ChildInput, schoolYear: number, now: string): Promise<void> {
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
    await this.childrenChanged();
  }

  /** Replaces a child's details. Returns false if there's no such child. */
  async updateChild(id: string, input: ChildInput, schoolYear: number): Promise<boolean> {
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
    if (changed > 0) await this.childrenChanged();
    return changed > 0;
  }

  async removeChild(id: string): Promise<boolean> {
    const removed = this.db.exec("DELETE FROM children WHERE id = ?", id).rowsWritten;
    if (removed > 0) await this.childrenChanged();
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

  private async childrenChanged(): Promise<void> {
    this.db.exec(
      `INSERT INTO meta (key, value) VALUES ('children_version', 1)
       ON CONFLICT (key) DO UPDATE SET value = value + 1`,
    );
    // Re-read stored mail for the new children. The delay lets a few quick edits share one run.
    if (this.env.SCHEDULED_WORK !== "0") {
      await this.schedule(REREAD_DELAY_SECONDS, "processScheduled", undefined, {
        idempotent: true,
      });
    }
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
        child_ids: string | null;
        maybe_child_ids: string | null;
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
        childIds: i.child_ids === null ? null : (JSON.parse(i.child_ids) as string[]),
        maybeChildIds:
          i.maybe_child_ids === null ? [] : (JSON.parse(i.maybe_child_ids) as string[]),
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

function errorName(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 80) : "unknown";
}
