# Build plan

Each step ships behind tests and deploys via Workers Builds.

1. **Scaffold:** Worker + Agents SDK, `wrangler.jsonc`, Vitest pool, `.dev.vars.example`, `.gitignore`.
2. **Provision:** set up Email Routing on `school.jasoncabot.com` (`hello@` and `privacy@`) pointing to the Worker, add the owner as a verified destination, onboard Email Service sending, create the R2 bucket and its lifecycle rules, connect Workers Builds and add the secrets.
3. **Inbound:** `email()` handler with the auth check, raw mail to R2 and the address lookup.
4. **Verification:** signed link, holding pending mail, promoting it on verify.
5. **Processing:** MIME parsing, `toMarkdown` for attachments, AI extraction into `items`.
6. **Retention:** `expires_at` on every row, and a single purge alarm re-armed to the next expiry. Test with fake time, and check that the R2 lifecycle rules are in place.
7. **Digest:** Sunday schedule, a short email built from next week's items, sent to all members.
8. **Web page:** magic-link sign-in; children and schools; household members; upcoming items; pause digest; delete data; privacy page (from `docs/privacy.md`).
9. **Owner trial:** the owner forwards real mail from both schools for a few weeks, then we tune the extraction and the digest copy.
10. **Automatic forwarding:** support mail-client forwarding rules and relay their confirmation emails.
11. **Before other parents join:** the privacy notice is live and the retention jobs are running.
