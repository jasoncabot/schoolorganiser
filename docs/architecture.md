# Architecture

One Worker (`src/index.ts`) with an `email()` handler, a `fetch()` handler and two Durable Object classes.

```
forwarded mail ─▶ Email Routing ─▶ email()  src/email/inbound.ts
                                     │ sender check (src/email/auth.ts)
                                     ├─ privacy@ ─▶ forward to owner
                                     └─ hello@ ─▶ R2 original
                                          ├─ unverified ─▶ Address DO holds it, verification email
                                          └─ verified ─▶ Household agent: receive → process → items

browser ─▶ static assets (/, /privacy, /render-pdf, /assets)
        └▶ fetch()  src/web/routes.ts: /verify, /sign-in, /household, /join, /stop, /render-source
```

## Storage

- **Address** (`src/address.ts`): one Durable Object per lower-cased address. Household id, verification state, send throttles and held mail. Forgotten entirely if it never verifies.
- **Household** (`src/household.ts`): one Agents SDK agent per household. SQLite tables `members`, `children`, `messages`, `items`, `unreadable`, `meta`. Tables are created and upgraded by `migrate()` on first use.
- **R2** (`MAIL`): `pending/<sha256(address)>/<id>.eml` for held mail, `mail/<household>/<id>.eml` for verified mail, `render/<id>.pdf` for temporary PDF copies. Keys never contain an address.

## Processing

`Household.receive()` records a message and schedules `processPending()`, which for each message:

1. Parses the `.eml` with `postal-mime` (`src/extract/message.ts`).
2. Reads attachments. For a PDF, `src/extract/render.ts` puts a copy in R2 and calls the `screenshot` Quick Action once per page on `/render-pdf?src=…&page=N`, which fetches the copy through a 5-minute signed `/render-source` link and draws the page with our pdf.js. `src/extract/pdf.ts` reads the text layer.
3. Sends one request (`src/extract/prompt.ts`) with the text, page images and the household's children.
4. Checks every returned field and resolves dates (`src/extract/parse.ts`), maps children's names to ids, and stores items in one transaction.

Messages record the extraction and children versions they were read with, so either changing re-reads them.

## Digest

`Household.digestScheduled()` runs at 6pm UK time each Sunday (`nextDigestTime()` in `src/email/digest.ts`), calls `sendDigest()` and schedules the next one. `digestEmail()` builds the email from stored items without side effects. Each member's copy has its own stop link (`src/web/stop.ts`, a signed token valid for a year).

## Retention

`Household.purgeExpired()` and `Address.purge()` delete what has expired and re-arm for the next expiry (`purgeTime()` rounds up to midnight UTC). The household uses one Agents SDK schedule; the address uses a native alarm. Both arm on start.

## Web

- Pages are rendered by `src/web/html.ts` (escaping template, shared shell, security headers).
- Sessions: `src/web/session.ts`. Tokens for every emailed link: `src/tokens.ts` (HMAC-SHA256 with `SIGNING_KEY`, purpose and expiry in the payload).

## Determinism

Code reads time, ids and random bytes only through `Deps` (`src/deps.ts`). Scheduled work is switched off when `SCHEDULED_WORK` is `"0"`. See `testing.md`.
