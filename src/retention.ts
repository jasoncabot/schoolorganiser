// How long we keep things. Must match docs/privacy.md and the R2 lifecycle rules (docs/runbook.md).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mail from senders who haven't verified yet (R2 prefix `pending/`). */
export const PENDING_DAYS = 7;
/** Original mail and attachments from verified households (R2 prefix `mail/`). */
export const MAIL_DAYS = 90;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}
