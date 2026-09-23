# Build plan

Each step ships with tests (see `testing.md`) and deploys via Workers Builds once `npm run check:ci` passes. Run `npm run check`, which includes Playwright, locally before pushing.

1. **Scaffold (done):** Worker and Agents SDK, `wrangler.jsonc` (plus `test/wrangler.test.jsonc` for tests), `@cloudflare/vitest-plugin` with the AI and email stub Workers, the `Deps` object, ESLint, Prettier, strict `tsc`, Playwright, the Tailwind v4 build, `.dev.vars.example` and `.gitignore`.
2. **Provision (done):** set up Email Routing on `school.jasoncabot.com` (`hello@` and `privacy@`) pointing to the Worker, add the owner as a verified destination, onboard Email Service sending, create the R2 bucket and its lifecycle rules, connect Workers Builds (build command `npm run check:ci && npm run build`, deploy command `npx wrangler deploy`) and add the secrets.
3. **Inbound (done):** `email()` handler with the auth check, raw mail to R2 and the address lookup.
4. **Verification (done):** signed link, holding pending mail, promoting it on verify.
5. **Processing (done):** MIME parsing, `toMarkdown` for PDF, DOCX and images, PPTX via `fflate`, recording unreadable files, AI extraction into `items`.
6. **Sign-in and children (done):** Browser Run page images for PDFs; magic-link sign-in; a page to add children (display name, school, year group, class) and household members; pass the children to extraction so the AI marks which child each item is for; re-read stored mail when children change.
7. **Retention (next):** `expires_at` on every row, and a single purge alarm re-armed to the next expiry. Test with the injected clock and `runDurableObjectAlarm`, and check that the R2 lifecycle rules are in place.
8. **Digest:** Sunday schedule, a short email built from next week's items, sent to all members. Only items for the household's children and whole-school items.
9. **Rest of the web page:** Tailwind v4 in the style set out in `design.md`; upcoming items; pause digest; delete data. (The privacy page is already live.)
10. **End to end:** Playwright journey from forward to verify, sign-in, letter and digest.
11. **Owner trial:** the owner forwards real mail from both schools for a few weeks, then we tune the extraction and the digest copy.
12. **Automatic forwarding:** support mail-client forwarding rules and relay their confirmation emails.
13. **Before other parents join:** the privacy notice is live and the retention alarms are working.
14. **After v1: ask a question** on the web page, answered from the household's letters and items.
