# Runbook

How the production resources were set up, so an agent or the owner can check or repeat it. Record commands here, never secret values.

Account: the owner's Cloudflare account. Zone: `jasoncabot.com`.

## Done

| Date       | What                                                                                                                                            | How                                                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-23 | R2 bucket `schoolorganiser-mail` (no jurisdiction restriction)                                                                                  | `wrangler r2 bucket create schoolorganiser-mail`                                                                                                                                                                         |
| 2026-09-23 | Lifecycle rule: `pending/` expires after 7 days                                                                                                 | `wrangler r2 bucket lifecycle add schoolorganiser-mail expire-pending pending/ --expire-days 7 --abort-multipart-days 1 -y`                                                                                              |
| 2026-09-23 | Lifecycle rule: `mail/` expires after 90 days                                                                                                   | `wrangler r2 bucket lifecycle add schoolorganiser-mail expire-mail mail/ --expire-days 90 --abort-multipart-days 1 -y`                                                                                                   |
| 2026-09-23 | First deploy with secrets `SIGNING_KEY` (48 random bytes, base64) and `PRIVACY_FORWARD_TO` (owner's address)                                    | `wrangler deploy --secrets-file <temp file outside the repo, deleted afterwards>`                                                                                                                                        |
| 2026-09-23 | Worker handles `privacy@` (forwards to `PRIVACY_FORWARD_TO` if Cloudflare's DMARC result is a pass) and accepts `hello@`; drops everything else | `src/email/inbound.ts`, deployed                                                                                                                                                                                         |
| 2026-09-23 | Custom domain `school.jasoncabot.com`; workers.dev turned off                                                                                   | `routes` + `workers_dev: false` in `wrangler.jsonc`, `wrangler deploy`                                                                                                                                                   |
| 2026-09-23 | Email Service sending for `school.jasoncabot.com` (id `ba46d2da696f4d66b93a2d7664fd0c25`)                                                       | `POST /zones/{zone}/email/sending/subdomains {"name":"school.jasoncabot.com"}`. Added only `_dmarc.school` (p=reject), `cf-bounce._domainkey.school` (DKIM), and MX + SPF on `cf-bounce.school`. Apex records untouched. |
| 2026-09-23 | Routing rules: `hello@` and `privacy@school.jasoncabot.com` → Worker `schoolorganiser`                                                          | `POST /zones/{zone}/email/routing/rules` (ids `e7f1780c…`, `faf4fae7…`)                                                                                                                                                  |
| 2026-09-23 | Owner's address is already a verified Email Routing destination                                                                                 | checked with `GET /accounts/{account}/email/routing/addresses`                                                                                                                                                           |

Live at https://school.jasoncabot.com.

To rotate a secret: `wrangler secret put SIGNING_KEY`. Rotating `SIGNING_KEY` invalidates outstanding verification and magic links.

## To do

1. **Enable Email Routing on `school.jasoncabot.com`:** `POST /zones/{zone}/email/routing/dns {"name":"school.jasoncabot.com"}`. This needs the token permission Zone → Zone Settings → Edit. It adds MX and SPF records on the subdomain only; the apex (iCloud mail) is untouched.
2. **Workers Builds:** connect the GitHub repo to the `schoolorganiser` Worker (dashboard only). Production branch `main`, build command `npm run check:ci && npm run build`, deploy command `npx wrangler deploy`. Builds must use npm 11, which is set in `packageManager`.

## Token permissions

The provisioning token needs: Account → Workers Scripts, Workers R2 Storage, Email Routing Addresses (Edit); Zone `jasoncabot.com` → DNS, Workers Routes, Email Routing Rules, Email Sending, Zone Settings (Edit).
