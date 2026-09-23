import { ITEM_KINDS, type ExtractedItem, type ItemKind } from "./prompt";

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
export function parseExtraction(result: unknown, sentAt: string): ExtractedItem[] | null {
  const payload = unwrap(result);
  if (payload === null || typeof payload !== "object" || !("items" in payload)) return null;
  const items = payload.items;
  if (!Array.isArray(items)) return null;
  return items.flatMap((raw) => {
    const item = cleanItem(raw, sentAt);
    return item === null ? [] : [item];
  });
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

function cleanItem(raw: unknown, sentAt: string): ExtractedItem | null {
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
  const kind = ITEM_KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : "other";
  const time =
    typeof r.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : null;
  return {
    date,
    time,
    kind,
    title,
    cost: text(r.cost, 40),
    location: text(r.location, 120),
    school: text(r.school, 120),
    child: text(r.child, 80),
    confidence: r.confidence === "high" ? "high" : "low",
  };
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
