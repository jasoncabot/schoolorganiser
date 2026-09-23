// Dates and times as UK parents read them: Europe/London, "Mon 6 Oct", "2pm".

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function londonParts(date: Date): LondonParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** The UK calendar date of an instant, as YYYY-MM-DD. */
export function londonDate(date: Date): string {
  const { year, month, day } = londonParts(date);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD date `days` later (or earlier). */
export function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The instant a UK wall-clock time happens, e.g. 18:00 on 2025-10-26 is 18:00Z (GMT). */
export function londonTime(date: string, hour: number, minute = 0): Date {
  const guess = Date.parse(`${date}T00:00:00.000Z`) + (hour * 60 + minute) * 60_000;
  const seen = londonParts(new Date(guess));
  const offset = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - guess;
  return new Date(guess - offset);
}

/** Day of the week for a YYYY-MM-DD date: 0 is Sunday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/**
 * "Tue 30 Sep" for a YYYY-MM-DD date. Built from our own names, because en-GB month
 * abbreviations vary between ICU versions ("Sep" vs "Sept").
 */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  return `${WEEKDAYS[d.getUTCDay()] ?? ""} ${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ""}`;
}

/** "Tue 30 Sep" for an instant, in UK time. */
export function ukDate(date: Date): string {
  return dayLabel(londonDate(date));
}

/** "Wed 8 Oct, 2:05pm" for an instant, in UK time. */
export function ukDateTime(date: Date): string {
  const { hour, minute } = londonParts(date);
  const hhmm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return `${ukDate(date)}, ${ukTime(hhmm)}`;
}

/** "9am", "8:15am", "2:30pm" from "HH:MM". */
export function ukTime(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${String(hour)}${suffix}`
    : `${String(hour)}:${String(m).padStart(2, "0")}${suffix}`;
}
