import { Agent } from "agents";
import { currentYearGroup, yearGroupLabel, type Child, type ChildInput } from "./children";
import { systemDeps, type Deps } from "./deps";
import { runModel } from "./extract/ai";
import { readMessage, type AttachmentOutcome, type Unreadable } from "./extract/message";
import { parseExtraction, parseNotes } from "./extract/parse";
import { relevance } from "./extract/relevance";
import { pdfRenderer } from "./extract/render";
import {
  EXTRACTION_MODEL,
  EXTRACTION_VERSION,
  extractionRequest,
  type ExtractedItem,
  type ExtractedNote,
} from "./extract/prompt";
import { digestEmail, nextDigestTime } from "./email/digest";
import { sendEmail } from "./email/outbound";
import { migrate } from "./household-schema";
import { addDays, MAIL_DAYS, purgeTime } from "./retention";
import { stopLink } from "./web/stop";

export { migrate };

export interface ReceivedMail {
  id: string;
  key: string;
  receivedAt: string;
  expiresAt: string;
  /** The member who forwarded it. */
  forwardedBy?: string;
}

/** One forwarded email and what happened to it, for the household's activity log. */
export interface Activity {
  id: string;
  receivedAt: string;
  forwardedBy: string | null;
  subject: string | null;
  status: MessageStatus;
  attempts: number;
  processedAt: string | null;
  /** Read with an older extraction or older children, so it will be read again. */
  rereading: boolean;
  lastError: string | null;
  items: number;
  notes: number;
  /** Null for emails read before attachments were recorded. */
  attachments: AttachmentOutcome[] | null;
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
  /** The email it was read from, or null once that's deleted (items outlive their emails). */
  source: { subject: string | null; receivedAt: string } | null;
}

/** A point worth knowing with no firm date, e.g. a club on offer. */
export interface StoredNote {
  id: string;
  messageId: string;
  text: string;
  school: string | null;
  child: string | null;
  childIds: string[] | null;
  maybeChildIds: string[];
  source: { subject: string | null; receivedAt: string };
}

export interface StoredMessage {
  id: string;
  subject: string | null;
  receivedAt: string;
  /** Body and attachment text as we read it, or null if it wasn't read. */
  text: string | null;
}

/** Attempts at processing one message before it's marked failed. */
export const MAX_ATTEMPTS = 3;
/** Wait after children change before re-reading stored mail. */
const REREAD_DELAY_SECONDS = 60;
/** Wait between attempts after a transient failure (e.g. Workers AI unavailable). */
const RETRY_SECONDS = 5 * 60;
/** Notes from emails older than this aren't put in the digest; they're on the web page. */
const DIGEST_NOTE_DAYS = 14;
/** The Coming up page shows notes from emails received this recently. */
export const PAGE_NOTE_DAYS = 30;
/** A digest is skipped if the last one went out more recently than this. */
const MIN_DIGEST_GAP_MS = 6 * 24 * 60 * 60 * 1000;

/** One per household: members, children, messages, extracted items and their retention. */
export class Household extends Agent<Env> {
  private schemaReady = false;

  /** Arms the purge and the digest on start, so households created before either are covered. */
  override async onStart(): Promise<void> {
    await this.armPurge();
    await this.armDigest();
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
      "INSERT OR IGNORE INTO messages (id, r2_key, received_at, expires_at, forwarded_by) VALUES (?, ?, ?, ?, ?)",
      mail.id,
      mail.key,
      mail.receivedAt,
      mail.expiresAt,
      mail.forwardedBy ?? null,
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
          "UPDATE messages SET attempts = ?, status = ?, last_error = ? WHERE id = ?",
          attempts,
          status,
          errorName(error),
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
      this.db.exec("DELETE FROM notes WHERE message_id = ?", message.id);
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

  /** Scheduled callback: sends this week's digest by the real clock, then arms next week's. */
  async digestScheduled(_payload: unknown, running?: { id: string }): Promise<void> {
    try {
      await this.sendDigest(systemDeps);
    } finally {
      await this.armDigest(running?.id);
    }
  }

  /**
   * Sends the digest to every member who hasn't stopped it. Skipped if one went out in the last
   * six days, so a repeated schedule can't send twice. Never logs content or addresses.
   */
  async sendDigest(deps: Deps): Promise<{ sent: number }> {
    const now = deps.clock.now();
    const last = this.meta("digest_sent_at");
    if (last !== null && now.getTime() - last < MIN_DIGEST_GAP_MS) return { sent: 0 };
    const recipients = this.db
      .exec<{ address: string }>(
        "SELECT address FROM members WHERE digest_stopped_at IS NULL ORDER BY joined_at, address",
      )
      .toArray();
    if (recipients.length === 0) return { sent: 0 };
    const unreadable = this.db
      .exec<{ id: number; filename: string; subject: string | null; reason: Unreadable["reason"] }>(
        `SELECT u.rowid AS id, u.filename, m.subject, u.reason FROM unreadable u
         JOIN messages m ON m.id = u.message_id
         WHERE u.mentioned_at IS NULL ORDER BY m.received_at, u.filename`,
      )
      .toArray();
    const failed = this.db
      .exec<{ id: string; received_at: string }>(
        `SELECT id, received_at FROM messages
         WHERE status = 'failed' AND failure_mentioned_at IS NULL ORDER BY received_at, id`,
      )
      .toArray();
    const items = this.items();
    const children = this.children();
    const noteCutoff = addDays(now, -DIGEST_NOTE_DAYS).toISOString();
    const notes = this.notes().filter(
      (n) => !this.notesMentioned(n.messageId) && n.source.receivedAt >= noteCutoff,
    );
    let sent = 0;
    for (const { address } of recipients) {
      const link = await stopLink(this.env, address, this.name, now);
      const email = digestEmail({
        now,
        items,
        children,
        unreadable,
        failed: failed.map((m) => ({ receivedAt: m.received_at })),
        notes,
        appOrigin: this.env.APP_ORIGIN,
        stopLink: link,
      });
      try {
        await sendEmail(this.env, address, email, {
          "List-Id": `Weekly summary <weekly.${new URL(this.env.APP_ORIGIN).hostname}>`,
          "List-Unsubscribe": `<${link}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        });
        sent++;
      } catch (error) {
        console.error("digest send failed", { error: errorName(error) });
      }
    }
    if (sent > 0) {
      for (const { id } of unreadable) {
        this.db.exec(
          "UPDATE unreadable SET mentioned_at = ? WHERE rowid = ?",
          now.toISOString(),
          id,
        );
      }
      for (const messageId of new Set(notes.map((n) => n.messageId))) {
        this.db.exec(
          "UPDATE messages SET notes_mentioned_at = ? WHERE id = ?",
          now.toISOString(),
          messageId,
        );
      }
      for (const { id } of failed) {
        this.db.exec(
          "UPDATE messages SET failure_mentioned_at = ? WHERE id = ?",
          now.toISOString(),
          id,
        );
      }
      this.setMeta("digest_sent_at", now.getTime());
    }
    console.log("digest sent", { sent, failed: recipients.length - sent });
    return { sent };
  }

  /** When the next digest is scheduled, or null. */
  async digestDue(): Promise<string | null> {
    const schedule = (await this.listSchedules()).find((s) => s.callback === "digestScheduled");
    return schedule === undefined ? null : new Date(schedule.time * 1000).toISOString();
  }

  /** Keeps one digest scheduled, for next Sunday evening. None when SCHEDULED_WORK is "0". */
  private async armDigest(runningScheduleId?: string): Promise<void> {
    if (this.env.SCHEDULED_WORK === "0") return;
    const existing = (await this.listSchedules()).filter(
      (s) => s.callback === "digestScheduled" && s.id !== runningScheduleId,
    );
    if (existing.length > 0) return;
    await this.schedule(nextDigestTime(systemDeps.clock.now()), "digestScheduled");
  }

  /** Starts digests to one member again. Returns false if they aren't a member. */
  startDigest(address: string): boolean {
    return (
      this.db.exec("UPDATE members SET digest_stopped_at = NULL WHERE address = ?", address)
        .rowsWritten > 0
    );
  }

  /** Removes one member. Their address must be forgotten separately (Address.forget). */
  removeMember(address: string): boolean {
    return this.db.exec("DELETE FROM members WHERE address = ?", address).rowsWritten > 0;
  }

  /**
   * Deletes everything the household holds, in R2 and here, and returns the members' addresses
   * so the caller can forget them. Call destroy() afterwards to remove the agent's own state.
   * Never logs content or addresses.
   */
  async deleteEverything(): Promise<string[]> {
    const members = this.members().map((m) => m.address);
    const keys = this.db
      .exec<{ r2_key: string }>("SELECT r2_key FROM messages")
      .toArray()
      .map((m) => m.r2_key);
    // Also anything under the household's prefix that no row points to.
    let cursor: string | undefined;
    do {
      const listed = await this.env.MAIL.list({ prefix: `mail/${this.name}/`, cursor });
      keys.push(...listed.objects.map((o) => o.key));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor !== undefined);
    const unique = [...new Set(keys)];
    for (let i = 0; i < unique.length; i += 1000) {
      await this.env.MAIL.delete(unique.slice(i, i + 1000));
    }
    this.ctx.storage.transactionSync(() => {
      for (const table of [
        "items",
        "notes",
        "unreadable",
        "messages",
        "children",
        "members",
        "meta",
      ]) {
        this.db.exec(`DELETE FROM ${table}`);
      }
    });
    for (const schedule of await this.listSchedules()) await this.cancelSchedule(schedule.id);
    console.log("household deleted", { objects: unique.length, members: members.length });
    return members;
  }

  /** Stops digests to one member. Returns false if they aren't a member. */
  stopDigest(address: string, now: string): boolean {
    return (
      this.db.exec(
        "UPDATE members SET digest_stopped_at = COALESCE(digest_stopped_at, ?) WHERE address = ?",
        now,
        address,
      ).rowsWritten > 0
    );
  }

  private meta(key: string): number | null {
    return (
      this.db.exec<{ value: number }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]
        ?.value ?? null
    );
  }

  private setMeta(key: string, value: number): void {
    this.db.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private async processMessage(
    id: string,
    key: string,
    receivedAt: string,
    deps: Deps,
  ): Promise<void> {
    const object = await this.env.MAIL.get(key);
    if (object === null) {
      this.db.exec(
        "UPDATE messages SET status = 'failed', last_error = 'Original email missing' WHERE id = ?",
        id,
      );
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
    let notes: ExtractedNote[] = [];
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
      notes = parseNotes(result);
    }
    this.store(id, {
      sentAt,
      subject: message.subject,
      text: message.text,
      unreadable: message.unreadable,
      attachments: message.attachments,
      items,
      notes,
      children,
      childrenVersion,
      processedAt: now.toISOString(),
    });
    console.log("message processed", {
      items: items.length,
      notes: notes.length,
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
      attachments: AttachmentOutcome[];
      items: ExtractedItem[];
      notes: ExtractedNote[];
      children: Child[];
      childrenVersion: number;
      processedAt: string;
    },
  ): void {
    this.ctx.storage.transactionSync(() => {
      // A file already mentioned in a digest stays mentioned when the email is read again.
      const mentioned = new Map(
        this.db
          .exec<{ filename: string; mentioned_at: string | null }>(
            "SELECT filename, mentioned_at FROM unreadable WHERE message_id = ?",
            id,
          )
          .toArray()
          .map((u) => [u.filename, u.mentioned_at]),
      );
      this.db.exec("DELETE FROM items WHERE message_id = ?", id);
      this.db.exec("DELETE FROM notes WHERE message_id = ?", id);
      this.db.exec("DELETE FROM unreadable WHERE message_id = ?", id);
      read.items.forEach((item, index) => {
        const { childIds, maybeChildIds } = relevance(item, read.children);
        this.db.exec(
          `INSERT INTO items (id, message_id, date, time, kind, title, cost, location, school, child, confidence, expires_at, child_ids, maybe_child_ids, date_unsure)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          item.dateUnsure ? 1 : 0,
        );
      });
      read.notes.forEach((note, index) => {
        const { childIds, maybeChildIds } = relevance(note, read.children);
        this.db.exec(
          `INSERT INTO notes (id, message_id, text, school, child, child_ids, maybe_child_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          `${id}-n${String(index)}`,
          id,
          note.text,
          note.school,
          note.child,
          childIds === null ? null : JSON.stringify(childIds),
          JSON.stringify(maybeChildIds),
        );
      });
      for (const file of read.unreadable) {
        this.db.exec(
          "INSERT INTO unreadable (message_id, filename, reason, mentioned_at) VALUES (?, ?, ?, ?)",
          id,
          file.filename,
          file.reason,
          mentioned.get(file.filename) ?? null,
        );
      }
      this.db.exec(
        `UPDATE messages SET status = 'done', subject = ?, sent_at = ?, body_text = ?, processed_at = ?,
           extraction_version = ?, children_version = ?, attempts = 0, last_error = NULL,
           attachments = ?
         WHERE id = ?`,
        read.subject,
        read.sentAt,
        read.text,
        read.processedAt,
        EXTRACTION_VERSION,
        read.childrenVersion,
        JSON.stringify(read.attachments),
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
    return this.meta("children_version") ?? 0;
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
  async addMember(address: string, joinedAt: string): Promise<void> {
    this.db.exec(
      "INSERT OR IGNORE INTO members (address, joined_at) VALUES (?, ?)",
      address,
      joinedAt,
    );
    await this.armDigest();
  }

  members(): { address: string; joinedAt: string; digestStoppedAt: string | null }[] {
    return this.db
      .exec<{ address: string; joined_at: string; digest_stopped_at: string | null }>(
        "SELECT address, joined_at, digest_stopped_at FROM members ORDER BY joined_at, address",
      )
      .toArray()
      .map((m) => ({
        address: m.address,
        joinedAt: m.joined_at,
        digestStoppedAt: m.digest_stopped_at,
      }));
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
        date_unsure: number;
        subject: string | null;
        received_at: string | null;
      }>(
        `SELECT i.*, m.subject, m.received_at FROM items i
         LEFT JOIN messages m ON m.id = i.message_id
         ORDER BY i.date, i.time, i.id`,
      )
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
        dateUnsure: i.date_unsure === 1,
        source: i.received_at === null ? null : { subject: i.subject, receivedAt: i.received_at },
      }));
  }

  /** Notes, newest email first. */
  notes(): StoredNote[] {
    return this.db
      .exec<{
        id: string;
        message_id: string;
        text: string;
        school: string | null;
        child: string | null;
        child_ids: string | null;
        maybe_child_ids: string;
        subject: string | null;
        received_at: string;
      }>(
        `SELECT n.*, m.subject, m.received_at FROM notes n
         JOIN messages m ON m.id = n.message_id
         ORDER BY m.received_at DESC, n.id`,
      )
      .toArray()
      .map((n) => ({
        id: n.id,
        messageId: n.message_id,
        text: n.text,
        school: n.school,
        child: n.child,
        childIds: n.child_ids === null ? null : (JSON.parse(n.child_ids) as string[]),
        maybeChildIds: JSON.parse(n.maybe_child_ids) as string[],
        source: { subject: n.subject, receivedAt: n.received_at },
      }));
  }

  private notesMentioned(messageId: string): boolean {
    return (
      this.db
        .exec<{ at: string | null }>(
          "SELECT notes_mentioned_at AS at FROM messages WHERE id = ?",
          messageId,
        )
        .toArray()[0]?.at != null
    );
  }

  /** Every stored email, newest first, with what happened to it. */
  activity(): Activity[] {
    const childrenVersion = this.childrenVersion();
    return this.db
      .exec<{
        id: string;
        received_at: string;
        forwarded_by: string | null;
        subject: string | null;
        status: MessageStatus;
        attempts: number;
        processed_at: string | null;
        extraction_version: number;
        children_version: number;
        last_error: string | null;
        items: number;
        notes: number;
        attachments: string | null;
      }>(
        `SELECT m.id, m.received_at, m.forwarded_by, m.subject, m.status, m.attempts,
                m.processed_at, m.extraction_version, m.children_version, m.last_error,
                m.attachments,
                (SELECT COUNT(*) FROM items i WHERE i.message_id = m.id) AS items,
                (SELECT COUNT(*) FROM notes n WHERE n.message_id = m.id) AS notes
         FROM messages m ORDER BY m.received_at DESC, m.id DESC`,
      )
      .toArray()
      .map((m) => ({
        id: m.id,
        receivedAt: m.received_at,
        forwardedBy: m.forwarded_by,
        subject: m.subject,
        status: m.status,
        attempts: m.attempts,
        processedAt: m.processed_at,
        rereading:
          m.status === "done" &&
          (m.extraction_version < EXTRACTION_VERSION || m.children_version < childrenVersion),
        lastError: m.last_error,
        items: m.items,
        notes: m.notes,
        attachments:
          m.attachments === null ? null : (JSON.parse(m.attachments) as AttachmentOutcome[]),
      }));
  }

  /** One stored email, for showing where an item came from; null if it's gone. */
  message(id: string): StoredMessage | null {
    const row = this.db
      .exec<{ subject: string | null; received_at: string; body_text: string | null }>(
        "SELECT subject, received_at, body_text FROM messages WHERE id = ?",
        id,
      )
      .toArray()[0];
    return row === undefined
      ? null
      : { id, subject: row.subject, receivedAt: row.received_at, text: row.body_text };
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
