# Build plan

Each step ships with tests (see `testing.md`) and deploys via Workers Builds once `npm run check:ci` passes. Run `npm run check`, which includes Playwright, locally before pushing.

1. **Scaffold (done):** Worker and Agents SDK, `wrangler.jsonc` (with an `e2e` environment), `@cloudflare/vitest-plugin` with the AI and email stub Workers, the `Deps` object, ESLint, Prettier, strict `tsc`, Playwright, the Tailwind v4 build, `.dev.vars.example` and `.gitignore`.
2. **Provision:** set up Email Routing on `school.jasoncabot.com` (`hello@` and `privacy@`) pointing to the Worker, add the owner as a verified destination, onboard Email Service sending, create the R2 bucket and its lifecycle rules, connect Workers Builds (build command `npm run check:ci && npm run build`, deploy command `npx wrangler deploy`) and add the secrets.
3. **Inbound:** `email()` handler with the auth check, raw mail to R2 and the address lookup.
4. **Verification:** signed link, holding pending mail, promoting it on verify.
5. **Processing:** MIME parsing, `toMarkdown` for PDF, DOCX and images, PPTX via `fflate`, recording unreadable files, AI extraction into `items`.
6. **Retention:** `expires_at` on every row, and a single purge alarm re-armed to the next expiry. Test with the injected clock and `runDurableObjectAlarm`, and check that the R2 lifecycle rules are in place.
7. **Digest:** Sunday schedule, a short email built from next week's items, sent to all members.
8. **Web page:** Tailwind v4 in the style set out in `design.md`; magic-link sign-in; children and schools; household members; upcoming items; pause digest; delete data; privacy page (from `docs/privacy.md`).
9. **End to end:** Playwright journey from forward to verify, sign-in, letter and digest.
10. **Owner trial:** the owner forwards real mail from both schools for a few weeks, then we tune the extraction and the digest copy.
11. **Automatic forwarding:** support mail-client forwarding rules and relay their confirmation emails.
12. **Before other parents join:** the privacy notice is live and the retention alarms are working.
