# Runbook

Production resources and how they were set up. Commands only, never secret values. Account: the owner's. Zone: `jasoncabot.com`. Site: https://school.jasoncabot.com.

## R2

- Bucket `schoolorganiser-mail`: `wrangler r2 bucket create schoolorganiser-mail`
- Lifecycle rules, each with `--abort-multipart-days 1 -y`:
  - `wrangler r2 bucket lifecycle add schoolorganiser-mail expire-pending pending/ --expire-days 7`
  - `wrangler r2 bucket lifecycle add schoolorganiser-mail expire-mail mail/ --expire-days 90`
  - `wrangler r2 bucket lifecycle add schoolorganiser-mail expire-render render/ --expire-days 1`

## Worker

- First deploy with secrets: `wrangler deploy --secrets-file <temp file outside the repo, deleted afterwards>`. `SIGNING_KEY` is 48 random bytes, base64. `PRIVACY_FORWARD_TO` is the owner's address.
- Rotate a secret with `wrangler secret put <NAME>`. Rotating `SIGNING_KEY` invalidates outstanding links and sessions.
- Custom domain `school.jasoncabot.com` via `routes` in `wrangler.jsonc`; workers.dev is off.
- Workers Builds (connected in the dashboard): branch `main`, build `npm run check:ci && npm run build`, deploy `npx wrangler deploy`, no preview builds. The build image installs with npm 10, which works with the lockfile. `.node-version` pins Node 22.

## Email

- Email Routing on `school.jasoncabot.com`: `POST /zones/{zone}/email/routing/dns {"name":"school.jasoncabot.com"}`. Adds MX and SPF on the subdomain only; the apex (iCloud) is untouched.
- Rules: `hello@` and `privacy@` → Worker `schoolorganiser`, via `POST /zones/{zone}/email/routing/rules`.
- The owner's address is a verified Email Routing destination (needed for `privacy@` forwarding).
- Email Service sending: `POST /zones/{zone}/email/sending/subdomains {"name":"school.jasoncabot.com"}`. Adds `_dmarc.school`, `cf-bounce._domainkey.school`, and MX and SPF on `cf-bounce.school`.

## API token permissions

Account: Workers Scripts, Workers R2 Storage, Email Routing Addresses. Zone `jasoncabot.com`: DNS, Workers Routes, Email Routing Rules, Email Sending, Zone Settings. All Edit.
