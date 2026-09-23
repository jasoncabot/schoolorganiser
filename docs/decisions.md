# Decisions

Settled with the owner. Don't reopen without asking. Replace a decision when it changes rather than adding a contradicting one; git keeps the history.

## Platform

- Cloudflare only: Workers, Durable Objects (Agents SDK), R2, Workers AI, Browser Run, Email Routing and Email Service. No third-party services. npm libraries are fine when Cloudflare's docs use them.
- Domain `school.jasoncabot.com` (zone `jasoncabot.com`) for mail and the web. No data-location restriction.
- Deploys: Workers Builds on push to `main`, running `npm run check:ci && npm run build`. Playwright runs locally in `npm run check` before every push.
- Until v1, work directly on `main`.
- Tooling pins: TypeScript 6.0 (`typescript-eslint` doesn't support 7), Vitest 4.1 (what `@cloudflare/vitest-plugin` supports), npm 11 with `allowScripts` for `workerd` and `esbuild` only.

## Inbound mail

- Addresses: `hello@` (forwarded school mail) and `privacy@` (forwarded to the owner via the `PRIVACY_FORWARD_TO` secret). Everything else is dropped.
- v1 supports manual forwards. Automatic forwarding rules come later.
- The sender is the `From` address. It's accepted if Cloudflare's own results show DMARC pass, or, when the domain has no DMARC record, SPF or DKIM passing for the From domain or a subdomain. A DMARC fail is always rejected. Failures are dropped silently.

## Verification and accounts

- An unknown sender's mail is held for 7 days and they get a signed verification link (at most one a day). Confirming creates a household, moves the held mail into it and signs them in.
- A household can have several verified addresses; one digest goes to all of them. Members invite others by a 7-day link. An address in another household can't join (no merging).
- Sign-in is by emailed link: 30 minutes, verified addresses only, at most one every two minutes, same answer for unknown addresses. Sessions are signed cookies (HttpOnly, Secure, SameSite=Lax, 30 days), re-checked against the address on every request.
- Links from emails show a button; only POST changes anything, because mail scanners follow links. POSTs with a foreign `Origin` are refused.

## Children and relevance

- Each child: display name, school (free text), year group (Nursery, Reception, Years 1–13) and optional class. Year groups move up each September; after Year 13 a child is "Left school" and left out of extraction.
- Parents change a child's school themselves; there's no detection of school moves.
- The model decides which children each item is for, given the household's children. A letter applies only to children at the school that sent it; whole-school items apply to every child there.
- If an item names a class and a matched child has no class set, it's "may apply" for them. Code enforces this.
- With no children set up, every item counts as relevant. Changing children re-reads stored mail a minute later.

## Reading and extraction

- Model: `@cf/mistralai/mistral-small-3.1-24b-instruct`, JSON mode, chosen as the cheapest that extracted every item in the evaluation (`npm run eval:extraction`).
- PDFs: page images from Browser Run's `screenshot` Quick Action (at most 10 pages per message) plus the text layer from `unpdf`, laid out column by column. No Workers AI model accepts a PDF file. toMarkdown is the fallback for scans.
- Word, Excel, images and HTML go through Workers AI toMarkdown. PowerPoint is unzipped with `fflate`. `.txt` and `.ics` are read as text. Anything else is recorded as unreadable and mentioned once in the digest.
- The model returns day, month and year as written. Code fills in a missing year: the next occurrence on or after 31 days before the email was sent.
- Item kinds: event, deadline, payment, kit, timing, closure, other. Weekly routines are skipped unless they start or change on a date.
- Processing is retried 5 minutes apart, up to 3 attempts. Bumping `EXTRACTION_VERSION` re-reads stored mail.

## Digest

- Sunday at 6pm UK time, scheduled per household (no global cron), at most one every 6 days.
- Covers Monday to Sunday, grouped by day, child's name on each line. At most 15 item lines across both sections, then "Plus N more."
- A "Coming up" section for deadlines and payments in the two weeks after that.
- Items for "maybe" children read "Oak class (may be Ada's)". Repeats (same date, time, title and children) are shown once.
- A quiet week sends "Nothing on this week."
- Each unreadable attachment, and each forwarded email we gave up on after 3 attempts, is mentioned in one digest only.
- Sent from a no-reply address; replies are dropped. Every digest has a stop link and one-click `List-Unsubscribe` headers (RFC 8058). Stopping stops digests to that address only; the household and its data stay.

## Privacy and retention

- Lawful basis: consent (forward, then verify). Data is used only to provide the service, never sold or used for marketing. The notice is `docs/privacy.md`, published at `/privacy`.
- Held mail: 7 days; an address that never verifies is then forgotten. Originals and their text: 90 days after receipt. Items: 90 days after their date. Children and members: until deleted. Logs: Workers Logs, 7 days.
- Deletion runs on per-household schedules and per-address alarms at the next expiry, not a daily job. R2 lifecycle rules back it up.

## Web and email design

- Tailwind CSS v4, plain and accessible, in plum and cream so it can't be mistaken for GOV.UK or any official service. Headings in Inter Tight, self-hosted. See `design.md`.

## After v1

- Asking questions about the household's letters on the web page.
