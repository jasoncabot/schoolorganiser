import type { Child } from "../children";
import type { StoredItem, StoredNote } from "../household";
import {
  addDaysToDate,
  dayLabel,
  londonDate,
  londonTime,
  ukDate,
  ukTime,
  weekday,
} from "../uk-time";
import type { Unreadable } from "../extract/message";
import { escape } from "../web/html";
import { COLOURS, layout, type OutboundEmail } from "./outbound";

/** Sunday at this hour, UK time. */
export const DIGEST_HOUR = 18;
/** Most item lines in one digest, across both sections (docs/decisions.md). */
export const MAX_LINES = 15;
/** Most "Worth knowing" lines in one digest. */
export const MAX_DIGEST_NOTES = 5;
/** "Coming up" covers deadlines and payments up to this many days ahead. */
const COMING_UP_DAYS = 21;

/** The next Sunday at DIGEST_HOUR, UK time, strictly after `now`. */
export function nextDigestTime(now: Date): Date {
  const today = londonDate(now);
  const sunday = addDaysToDate(today, (7 - weekday(today)) % 7);
  const time = londonTime(sunday, DIGEST_HOUR);
  return time > now ? time : londonTime(addDaysToDate(sunday, 7), DIGEST_HOUR);
}

export interface DigestInput {
  now: Date;
  items: StoredItem[];
  children: Child[];
  /** Attachments we couldn't read and haven't mentioned yet. */
  unreadable: { filename: string; subject: string | null; reason: Unreadable["reason"] }[];
  /** Forwarded emails we gave up on and haven't mentioned yet. */
  failed: { receivedAt: string }[];
  /** Notes from recent emails not yet in a digest. */
  notes: StoredNote[];
  appOrigin: string;
  stopLink: string;
}

interface Line {
  date: string;
  text: string;
}

/**
 * The weekly email: the seven days from tomorrow, grouped by day, then deadlines and payments in
 * the fortnight after. Only items for the household's children, "maybe" items and, when no
 * children are set up, everything.
 */
export function digestEmail(input: DigestInput): OutboundEmail {
  const first = addDaysToDate(londonDate(input.now), 1);
  const last = addDaysToDate(first, 6);
  const comingUpLast = addDaysToDate(first, COMING_UP_DAYS - 1);
  const names = childNames(input.children);
  const relevant = relevantItems(input.items);

  const week = relevant
    .filter((i) => i.date >= first && i.date <= last)
    .map((i) => ({ date: i.date, text: describeItem(i, names) }));
  const comingUp = relevant
    .filter(
      (i) =>
        (i.kind === "deadline" || i.kind === "payment") && i.date > last && i.date <= comingUpLast,
    )
    .map((i) => ({ date: i.date, text: `${dayLabel(i.date)}, ${describeItem(i, names)}` }));
  const weekShown = week.slice(0, MAX_LINES);
  const comingUpShown = comingUp.slice(0, MAX_LINES - weekShown.length);

  const heading = `Week of ${dayLabel(first)}`;
  const subject = `School this week: ${dayLabel(first)} to ${dayLabel(last)}`;
  const hello = `hello@${new URL(input.appOrigin).hostname}`;
  const upcoming = `${input.appOrigin}/household/upcoming`;
  const more = (shown: Line[], all: Line[]): string | null =>
    all.length > shown.length ? `Plus ${String(all.length - shown.length)} more` : null;
  const missing = input.unreadable.filter((f) => f.reason === "not attached");
  const broken = input.unreadable.filter((f) => f.reason !== "not attached");
  const unreadable = [
    broken.length === 0
      ? null
      : `We couldn't read ${broken.map(fileLabel).join(", ")}. Check the original ${broken.length === 1 ? "email" : "emails"}.`,
    missing.length === 0
      ? null
      : `${missing.map(fileLabel).join(", ")} ${missing.length === 1 ? "wasn't" : "weren't"} attached when forwarded. Forward again and choose to include attachments.`,
  ].filter((p) => p !== null);

  const failed = failedNote(input.failed);

  const text: string[] = [heading, ""];
  const html: string[] = [];
  if (week.length === 0) {
    text.push("Nothing on this week.", "");
    html.push(paragraph("Nothing on this week."));
  }
  for (const [date, lines] of byDay(weekShown)) {
    text.push(dayLabel(date), ...lines.map((l) => `- ${l.text}`), "");
    html.push(subheading(dayLabel(date)), list(lines));
  }
  const weekMore = more(weekShown, week);
  if (weekMore !== null) {
    text.push(`${weekMore}: ${upcoming}`, "");
    html.push(moreLink(weekMore, upcoming));
  }
  if (comingUp.length > 0) {
    text.push("Coming up", ...comingUpShown.map((l) => `- ${l.text}`));
    html.push(subheading("Coming up"));
    if (comingUpShown.length > 0) html.push(list(comingUpShown));
    const comingUpMore = more(comingUpShown, comingUp);
    if (comingUpMore !== null) {
      text.push(`${comingUpMore}: ${upcoming}`);
      html.push(moreLink(comingUpMore, upcoming));
    }
    text.push("");
  }
  const notes = relevantNotes(input.notes).map((n) => ({
    date: "",
    text: describeNote(n, names),
  }));
  if (notes.length > 0) {
    const shown = notes.slice(0, MAX_DIGEST_NOTES);
    text.push("Worth knowing", ...shown.map((l) => `- ${l.text}`));
    html.push(subheading("Worth knowing"), list(shown));
    const notesMore = more(shown, notes);
    if (notesMore !== null) {
      text.push(`${notesMore}: ${upcoming}`);
      html.push(moreLink(notesMore, upcoming));
    }
    text.push("");
  }
  if (failed !== null) {
    text.push(failed, "");
    html.push(paragraph(failed, COLOURS.muted));
  }
  for (const note of unreadable) {
    text.push(note, "");
    html.push(paragraph(note, COLOURS.muted));
  }
  text.push(
    "--",
    `Stop these emails: ${input.stopLink}`,
    `School Organiser · Forward school emails to ${hello}`,
    `Privacy: ${input.appOrigin}/privacy`,
  );
  return {
    subject,
    text: text.join("\n"),
    html: layout(heading, html.join("\n"), input.appOrigin, hello, input.stopLink),
  };
}

/** Items for the household's children (or "maybe"), by date and time, without repeats. */
export function relevantItems(items: StoredItem[]): StoredItem[] {
  return unique(items.filter(isRelevant).sort(byDateAndTime));
}

export function childNames(children: Child[]): Map<string, string> {
  return new Map(children.map((c) => [c.id, c.name]));
}

/** Notes for the household's children (or "maybe"), without repeats, in the order given. */
export function relevantNotes(notes: StoredNote[]): StoredNote[] {
  const seen = new Set<string>();
  return notes.filter((n) => {
    const key = n.text.toLowerCase();
    if (!isRelevant(n) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "Ada: Judo club on Wednesdays, £72 for 9 lessons; book with coach@example.com." */
export function describeNote(note: StoredNote, names: Map<string, string>): string {
  const who = audience(note, names);
  return who === null ? note.text : `${who}: ${note.text}`;
}

interface Audience {
  child: string | null;
  childIds: string[] | null;
  maybeChildIds: string[];
}

function isRelevant(item: Audience): boolean {
  return item.childIds === null || item.childIds.length > 0 || item.maybeChildIds.length > 0;
}

/** By date, then all-day items, then by time. */
function byDateAndTime(a: StoredItem, b: StoredItem): number {
  return a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "");
}

/** Drops repeats, e.g. the same letter forwarded by both parents, or a reminder letter. */
function unique(items: StoredItem[]): StoredItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = JSON.stringify([
      i.date,
      i.time,
      i.title.toLowerCase(),
      i.childIds,
      i.maybeChildIds,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "Ada: Trip to Chester Zoo, 8:15am, Chester Zoo, £18.50" */
export function describeItem(item: StoredItem, names: Map<string, string>): string {
  const details = [
    item.title,
    item.time === null ? null : ukTime(item.time),
    item.location,
    item.cost,
  ]
    .filter((d) => d !== null)
    .join(", ");
  const who = audience(item, names);
  const line = who === null ? details : `${who}: ${details}`;
  return item.dateUnsure ? `${line} (check the date)` : line;
}

function audience(item: Audience, names: Map<string, string>): string | null {
  const nameOf = (ids: string[]): string[] => ids.flatMap((id) => names.get(id) ?? []);
  if (item.childIds === null) return item.child;
  const sure = nameOf(item.childIds);
  if (sure.length > 0) return joinNames(sure);
  const maybe = nameOf(item.maybeChildIds).map((n) => `${n}'s`);
  return `${item.child ?? "Some pupils"} (may be ${joinNames(maybe, "or")})`;
}

function joinNames(names: string[], conjunction = "and"): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1) ?? ""}`;
}

/** "We couldn't read an email forwarded on Wed 8 Oct. Try forwarding it again." */
function failedNote(failed: { receivedAt: string }[]): string | null {
  if (failed.length === 0) return null;
  const days = [...new Set(failed.map((f) => ukDate(new Date(f.receivedAt))))];
  const one = failed.length === 1;
  return `We couldn't read ${one ? "an email" : `${String(failed.length)} emails`} forwarded on ${joinNames(days)}. Try forwarding ${one ? "it" : "them"} again.`;
}

function fileLabel(file: { filename: string; subject: string | null }): string {
  return file.subject === null ? file.filename : `${file.filename} (in "${file.subject}")`;
}

function byDay(lines: Line[]): Map<string, Line[]> {
  const days = new Map<string, Line[]>();
  for (const line of lines) days.set(line.date, [...(days.get(line.date) ?? []), line]);
  return days;
}

function subheading(text: string): string {
  return `<h2 style="font-family:&quot;Inter Tight&quot;, Arial, Helvetica, sans-serif;font-weight:bold;font-size:19px;line-height:1.3;margin:24px 0 8px">${escape(text)}</h2>`;
}

function list(lines: Line[]): string {
  const items = lines.map((l) => `<li style="margin:0 0 4px">${escape(l.text)}</li>`).join("");
  return `<ul style="margin:0 0 16px;padding-left:20px">${items}</ul>`;
}

function moreLink(text: string, href: string): string {
  return `<p style="margin:0 0 16px"><a href="${escape(href)}" style="color:${COLOURS.link}">${escape(text)}</a></p>`;
}

function paragraph(text: string, colour = COLOURS.ink): string {
  return `<p style="margin:0 0 16px;color:${colour}">${escape(text)}</p>`;
}
