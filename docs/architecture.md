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

- **Worker (single script):** includes the `email()` handler, the `fetch()` handler (web page and API, verification links) and the Agent classes.
- **Household Agent:** one per household, keyed by household ID. It holds members, children, schools, messages, extracted items and digest history.
- **Address lookup (proposed):** a small Durable Object per email address (`idFromName(normalisedEmail)`) that stores its household ID and verification state. This keeps everything in Durable Objects and avoids a separate database.
- **R2 bucket:** holds raw mail and attachments. Lifecycle rules: the `pending/` prefix expires after 7 days and `mail/` after 90 days.
- **Workers AI:** `toMarkdown` handles PDF and DOCX attachments. An LLM does extraction and digest writing. Pick the model from the current catalogue when building and record the choice in `decisions.md`.
- **Email Service:** sends verification emails, magic links and digests from `school.jasoncabot.com`. The domain needs onboarding for sending (SPF/DKIM/DMARC records).
- **Workers Secrets:** holds the HMAC key for verification and magic links. Nothing secret goes in the repo.

## Extracted item (proposed shape)

`date`, `time?`, `kind` (event, deadline, payment, kit, early start/late finish, closure, other), `title`, `cost?`, `location?`, `school`, `child?`, `source_message_id`, `confidence`.

## Implementation notes

- Europe/London changes offset (GMT/BST). The Sunday schedule must fire at the right local time all year round.
- SPF/DKIM/DMARC results come from the headers Email Routing adds. Confirm the exact header against current docs.
