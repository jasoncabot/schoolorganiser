# Decisions

Settled with the owner. Add new ones at the bottom with a date.

| Date | Decision |
|---|---|
| 2026-09-23 | Cloudflare only. No third-party services. |
| 2026-09-23 | Inbound domain is the subdomain `school.jasoncabot.com` (zone `jasoncabot.com`, already on Cloudflare). |
| 2026-09-23 | Outbound mail uses Cloudflare Email Service (`send_email` binding, `remote: true`). The account is on Workers Paid, so we can send to any recipient. |
| 2026-09-23 | AI is Workers AI only. |
| 2026-09-23 | Extracted text and items live in a per-household Durable Object (SQLite). Raw `.eml` files and attachments go to R2 and expire after 90 days. |
| 2026-09-23 | Households can have several verified email addresses, with one shared digest sent to all of them. |
| 2026-09-23 | Spam gate: reply only if the forwarder passes SPF/DKIM/DMARC. Anything else is dropped silently and logged. |
| 2026-09-23 | Mail from unverified senders is held for 7 days, then deleted. |
| 2026-09-23 | Digest goes out weekly, on Sunday evening, UK time. |
| 2026-09-23 | v1 includes a minimal web page with magic-link sign-in. Children and schools are set up there. |
| 2026-09-23 | Stack: TypeScript, Agents SDK, Workers AI `toMarkdown` for attachments, Vitest with the Workers pool. |
| 2026-09-23 | Deploys go through Workers Builds (Cloudflare's Git-connected CI). No deploy token is stored in GitHub. |
| 2026-09-23 | Cloudflare agent skills (`cloudflare/skills`) are enabled at project level. |
