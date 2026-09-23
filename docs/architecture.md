# Architecture

Marked **(proposed)** where it isn't settled yet. Confirm with the owner before building those parts.

```
parent ──forward──▶ Email Routing (hello@school.jasoncabot.com)
                          │
                          ▼
                 Worker email() handler
                  1. check SPF/DKIM/DMARC  ──fail──▶ drop + log
                  2. store raw .eml in R2
                  3. look up sender → household
                          │
          unknown/unverified ──▶ hold (R2 pending/) + send verification link
                          │ verified
                          ▼
              Household Agent (Durable Object, SQLite)
                  - parse MIME (postal-mime)
                  - attachments → env.AI.toMarkdown
                  - Workers AI extracts items → `items` table
                  - this.schedule: Sunday digest → Email Service
                          ▲
                          │
        Web page (Workers static assets + magic-link session)
```

## Components

- **Worker (single script):** includes the `email()` handler, the `fetch()` handler (web page and API, verification links) and the Agent classes. Static pages (`/`, `/privacy`) come from Workers static assets; `/verify` is rendered by the Worker (`src/web/`).
- **Household Agent:** one per household, keyed by household ID. It holds members, children, schools, messages, extracted items and digest history.
- **Address lookup:** a small Durable Object per email address (`getByName(normalisedEmail)`) that stores its household ID and verification state, plus the R2 keys of mail held while unverified. The address comes from the DMARC-authenticated `From` header, not the envelope sender. v1 identifies the parent from the manual forwarder's address. Keep the sender-identification step separate so automatic forwarding can plug in later.
- **R2 bucket:** holds raw mail and attachments. Keys are `pending/<sha256(address)>/<id>.eml` for unverified senders and `mail/<householdId>/<id>.eml` for verified ones. Lifecycle rules: `pending/` expires after 7 days and `mail/` after 90 days. Keys never contain an email address.
- **Attachments:** PDF, DOCX and images go through `env.AI.toMarkdown`. `toMarkdown` doesn't support PowerPoint, so PPTX is unzipped with `fflate` to read the text and notes from `ppt/slides/*.xml` and `ppt/notesSlides/*.xml`, and its embedded images go through `toMarkdown`. `.ppt`/`.doc` and other unreadable formats are recorded as unreadable and mentioned once in the digest.
- **Workers AI:** An LLM does extraction and digest writing, using the cheapest current model that extracts correctly (see `decisions.md`).
- **Email Service:** sends verification emails, magic links and digests from a no-reply address on `school.jasoncabot.com`. The domain needs onboarding for sending (SPF/DKIM/DMARC records). Digests carry `List-Unsubscribe` headers and a signed one-click stop link.
- **Privacy inbox:** `privacy@school.jasoncabot.com` routes to the same Worker. It applies the same SPF/DKIM/DMARC gate and then forwards to the owner with `message.forward()`. The owner's address is a Workers Secret (`PRIVACY_FORWARD_TO`) and must be a verified Email Routing destination. The public address is fine in the repo because the privacy page shows it anyway.
- **Retention:** no daily job. Each household has one Agents SDK schedule for its earliest expiry (messages 90 days after receipt, items 90 days after their date), rounded up to midnight UTC and re-armed after each purge. Each address has a native alarm for held mail (7 days); an address that never verified is then forgotten entirely. R2 lifecycle rules (`pending/` 7 days, `mail/` 90 days, `render/` 1 day) back this up. See `src/retention.ts`, `Household.purgeExpired`, `Address.purge`.
- **Workers Secrets:** holds the HMAC key for verification and magic links, and `PRIVACY_FORWARD_TO`. Nothing secret goes in the repo.

## Processing

1. `Household.receive()` records the message (status `new`) and schedules `processScheduled` (Agents SDK `schedule`, idempotent).
2. `processPending()` takes each `new` message: it reads the `.eml` from R2 and parses it with `postal-mime` (`src/extract/message.ts`).
3. The body is used as text; an HTML-only body goes through toMarkdown. Attachments: PDFs are drawn as page images by Browser Run's `screenshot` Quick Action (`src/extract/render.ts`: a temporary R2 copy under `render/`, served through a 5-minute signed `/render-source` link to `public/render-pdf.html`, which draws one page with our copy of pdf.js) and also read with `unpdf`, laid out column by column (`src/extract/pdf.ts`), with toMarkdown as the fallback for scans; Word, Excel, images and HTML go through toMarkdown; PPTX is unzipped with `fflate` (`src/extract/pptx.ts`); `.txt` and `.ics` are read as text; anything else is recorded in `unreadable`.
4. One Workers AI call (`src/extract/prompt.ts`, JSON mode, with any page images) returns items with day, month and year as written. `src/extract/parse.ts` resolves the full date in code, checks every field and drops items that don't make sense.
5. Items, unreadable files and the extracted text are stored in one transaction, and the message becomes `done`.

## Extracted item

`date` (YYYY-MM-DD), `time` (HH:MM or null), `kind` (event, deadline, payment, kit, timing, closure, other), `title`, `cost`, `location`, `school`, `child` (as written, e.g. "Year 3"), `confidence` (high/low), `message_id`, `expires_at` (90 days after `date`), `child_ids` (the household's children it applies to, decided by the model from the children in the prompt; null if the household had none set up).

## Web

- `/sign-in`, `/sign-in/confirm`, `/sign-out`: magic-link sign-in and a signed session cookie (`src/web/session.ts`).
- `/household`: children and members; `/household/children/…` to add, change and remove children; `/household/members` to invite.
- `/join`: accepting an invitation.
- `/verify`: confirming an address (also signs in).
- Every POST that changes anything checks the Origin header; every GET reached from an emailed link only shows a button.

## Implementation notes

- All time, IDs and randomness come from an injected `Deps` object (`clock`, `ids`, `random`), never from globals. This is what keeps the tests deterministic (see `testing.md`).

- Europe/London changes offset (GMT/BST). The Sunday schedule must fire at the right local time all year round.
- SPF/DKIM/DMARC results come from the headers Email Routing adds. Confirm the exact header against current docs.
