# Runbook

How the production resources were set up, so an agent or the owner can check or repeat it. Record commands here, never secret values.

Account: the owner's Cloudflare account. Zone: `jasoncabot.com`.

## Done

| Date       | What                                                                                                         | How                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-23 | R2 bucket `schoolorganiser-mail` (no jurisdiction restriction)                                               | `wrangler r2 bucket create schoolorganiser-mail`                                                                            |
| 2026-09-23 | Lifecycle rule: `pending/` expires after 7 days                                                              | `wrangler r2 bucket lifecycle add schoolorganiser-mail expire-pending pending/ --expire-days 7 --abort-multipart-days 1 -y` |
| 2026-09-23 | Lifecycle rule: `mail/` expires after 90 days                                                                | `wrangler r2 bucket lifecycle add schoolorganiser-mail expire-mail mail/ --expire-days 90 --abort-multipart-days 1 -y`      |
| 2026-09-23 | First deploy with secrets `SIGNING_KEY` (48 random bytes, base64) and `PRIVACY_FORWARD_TO` (owner's address) | `wrangler deploy --secrets-file <temp file outside the repo, deleted afterwards>`                                           |

Live at https://schoolorganiser.jasoncabot.workers.dev.

To rotate a secret: `wrangler secret put SIGNING_KEY`. Rotating `SIGNING_KEY` invalidates outstanding verification and magic links.

## To do (needs the wider API token or the dashboard)

1. **Email Routing on `school.jasoncabot.com`:** enable it for the subdomain (Email Routing → Settings → Subdomains). Cloudflare adds the MX/SPF records to the subdomain only. The apex `jasoncabot.com` mail is untouched.
2. **Destination address:** add the owner's address as a verified Email Routing destination. The owner clicks the link Cloudflare emails. `privacy@` forwards there.
3. **Routing rules:** send `hello@school.jasoncabot.com` and `privacy@school.jasoncabot.com` to the `schoolorganiser` Worker, and drop everything else.
4. **Email Service sending:** onboard `school.jasoncabot.com` (Email Sending → Onboard Domain). This adds SPF, DKIM and DMARC under `cf-bounce` and `_dmarc`.
5. **Custom domain:** add `school.jasoncabot.com` as a Workers custom domain, then set `workers_dev: false` in `wrangler.jsonc`.
6. **Workers Builds:** connect the GitHub repo to the `schoolorganiser` Worker (dashboard only). Production branch `main`, build command `npm run check:ci && npm run build`, deploy command `npx wrangler deploy`. Builds must use npm 11, which is set in `packageManager`.
