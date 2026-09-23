import { ITEM_KINDS, type ExtractedItem, type ExtractedNote, type ItemKind } from "./prompt";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Dates up to this long before the email was sent can be about the recent past. */
const LOOK_BACK_DAYS = 31;

/**
 * The full date for a day and month, given when the email was sent. The model gives the year
 * only when the letter states it; otherwise it's the next time that day and month come round,
 * counting from LOOK_BACK_DAYS before the email (letters sometimes mention recent events).
 * Two-digit years are 20xx. Returns null for impossible dates such as 30 February.
 */
export function resolveDate(
  day: number,
  month: number,
  year: number | null,
  sentAt: string,
): string | null {
  const sent = new Date(sentAt);
  if (Number.isNaN(sent.getTime())) return null;
  const build = (y: number): Date | null => {
    const date = new Date(Date.UTC(y, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
  };
  if (year !== null) {
    const stated = build(year < 100 ? 2000 + year : year);
    return stated === null ? null : stated.toISOString().slice(0, 10);
  }
  // The next occurrence on or after the look-back point; up to 4 years ahead finds 29 February.
  const earliest = sent.getTime() - LOOK_BACK_DAYS * DAY_MS;
  let resolved: Date | null = null;
  for (let y = sent.getUTCFullYear(); y <= sent.getUTCFullYear() + 4 && resolved === null; y++) {
    const candidate = build(y);
    if (candidate !== null && candidate.getTime() >= earliest) resolved = candidate;
  }
  return resolved === null ? null : resolved.toISOString().slice(0, 10);
}

/**
 * Turns a Workers AI response into valid items, or null if it's unusable. Models differ in
 * where they put the answer (`response` as an object or a JSON string, or OpenAI-style
 * `choices`), and small models sometimes bend the schema, so every field is checked.
 * Items that don't make sense are dropped rather than failing the whole message.
 */
export function parseExtraction(
  result: unknown,
  sentAt: string,
  /** The letter's text, to check times against. Omit when the model also saw page images. */
  sourceText?: string,
): ExtractedItem[] | null {
  const payload = unwrap(result);
  if (payload === null || typeof payload !== "object" || !("items" in payload)) return null;
  const items = payload.items;
  if (!Array.isArray(items)) return null;
  return items.flatMap((raw) => {
    const item = cleanItem(raw, sentAt, sourceText);
    return item === null ? [] : [item];
  });
}

/** At most this many notes are kept from one email. */
export const MAX_NOTES = 5;

/** The notes in a Workers AI response; [] if there are none or they're unusable. */
export function parseNotes(result: unknown): ExtractedNote[] {
  const payload = unwrap(result);
  if (payload === null || typeof payload !== "object" || !("notes" in payload)) return [];
  const notes = payload.notes;
  if (!Array.isArray(notes)) return [];
  return notes
    .flatMap((raw): ExtractedNote[] => {
      if (raw === null || typeof raw !== "object") return [];
      const r = raw as Record<string, unknown>;
      const noteText = text(r.text, 240);
      if (noteText === null) return [];
      return [
        {
          text: noteText,
          school: text(r.school, 120),
          child: audienceOf(r.child, r.school),
          forChildren: names(r.for),
          maybeChildren: names(r.maybe),
        },
      ];
    })
    .slice(0, MAX_NOTES);
}

function unwrap(result: unknown): unknown {
  if (result === null || typeof result !== "object") return null;
  const r = result as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const candidate = r.response ?? r.choices?.[0]?.message?.content;
  if (typeof candidate === "string") {
    const json = /\{[\s\S]*\}/.exec(candidate)?.[0];
    if (json === undefined) return null;
    try {
      return JSON.parse(json) as unknown;
    } catch {
      return null;
    }
  }
  return candidate ?? null;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** 0 (Sunday) to 6 from "Tuesday", "Tues" or "tue"; null if it isn't a weekday. */
export function weekdayNumber(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const index = WEEKDAYS.indexOf(value.trim().slice(0, 3).toLowerCase());
  return index === -1 ? null : index;
}

/**
 * Whether a letter's text states a clock time, written any usual way: 15:30 appears as
 * "15:30", "15.30", "3:30", "3.30" or "3.30pm"; 15:00 also as "3pm" or "3 pm".
 */
export function statesTime(text: string, time: string): boolean {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const hours = [String(h), String(h).padStart(2, "0"), String(h % 12 === 0 ? 12 : h % 12)];
  const mm = String(m).padStart(2, "0");
  const forms = hours.flatMap((hh) => [`${hh}:${mm}`, `${hh}.${mm}`]);
  if (m === 0) {
    const suffix = h < 12 ? "am" : "pm";
    forms.push(...hours.map((hh) => `${hh}${suffix}`), ...hours.map((hh) => `${hh} ${suffix}`));
    if (h === 12) forms.push("noon", "midday");
  }
  const lower = text.toLowerCase();
  return forms.some((f) => new RegExp(`(^|[^\\d])${f.replaceAll(".", "\\.")}`).test(lower));
}

function cleanItem(raw: unknown, sentAt: string, sourceText?: string): ExtractedItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const day = integer(r.day);
  const month = integer(r.month);
  const year = r.year === null || r.year === undefined ? null : integer(r.year);
  const date =
    day === null || month === null || (r.year != null && year === null)
      ? null
      : resolveDate(day, month, year, sentAt);
  const title = text(r.title, 120);
  if (date === null || title === null) return null;
  // A stated weekday that disagrees with the date means the day, month or year was misread,
  // or the letter is wrong. Keep the date but say so: moving it could hide a real event.
  const weekday = weekdayNumber(r.weekday);
  const dateUnsure = weekday !== null && new Date(`${date}T00:00:00.000Z`).getUTCDay() !== weekday;
  const kind = ITEM_KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : "other";
  // Small models fill in "after school" as a time; keep only times the letter states.
  const time =
    typeof r.time === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) &&
    (sourceText === undefined || statesTime(sourceText, r.time))
      ? r.time
      : null;
  return {
    date,
    time,
    kind,
    title,
    cost: text(r.cost, 40),
    location: text(r.location, 120),
    school: text(r.school, 120),
    child: audienceOf(r.child, r.school),
    confidence: r.confidence === "high" && !dateUnsure ? "high" : "low",
    dateUnsure,
    repeats: text(r.repeats, 160),
    forChildren: names(r.for),
    maybeChildren: names(r.maybe),
  };
}

/**
 * The item's audience, or null when the model gave the school's own name there: a school name
 * would otherwise read as a class name and make the item a "maybe".
 */
function audienceOf(child: unknown, school: unknown): string | null {
  const audience = text(child, 80);
  const schoolName = text(school, 120);
  if (audience === null) return null;
  const a = audience.toLowerCase();
  const s = schoolName?.toLowerCase();
  return s !== undefined && (a === s || s.includes(a) || a.includes(s)) ? null : audience;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((name) =>
    typeof name === "string" && name.trim() !== "" ? [name.trim()] : [],
  );
}

function integer(value: unknown): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || /^(null|none|n\/a)$/i.test(trimmed)) return null;
  return trimmed.slice(0, max);
}

/** Year groups, key stages and whole-school wording: anything else in `child` is a class name. */
const NOT_A_CLASS =
  /\b(year|yr|y\s?\d|reception|nursery|eyfs|early years|ks\s?\d|key stage|whole|all|every|school|pupils|children|sixth form)\b/i;

/**
 * Whether an item's audience (the `child` field, as written in the letter) names a class, e.g.
 * "Oak class" or "Hazel", rather than a year group, key stage or the whole school.
 */
export function namesAClass(audience: string | null): boolean {
  return audience !== null && !NOT_A_CLASS.test(audience);
}
