// How long we keep things. Must match docs/privacy.md and the R2 lifecycle rules (docs/runbook.md).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mail from senders who haven't verified yet (R2 prefix `pending/`). */
export const PENDING_DAYS = 7;
/** Original mail and attachments from verified households (R2 prefix `mail/`). */
export const MAIL_DAYS = 90;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * When to run a purge for something expiring at `expiresAt`: the next midnight (UTC) at or after
 * it, so rows expiring on the same day share one wake-up. Data may outlive its expiry by up to a
 * day, which the privacy notice allows for.
 */
export function purgeTime(expiresAt: string): Date {
  const time = new Date(expiresAt);
  const midnight = Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate());
  return new Date(midnight === time.getTime() ? midnight : midnight + DAY_MS);
}
