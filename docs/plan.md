# Build plan

Each step ships behind tests and deploys via Workers Builds.

1. **Scaffold:** Worker + Agents SDK, `wrangler.jsonc`, Vitest pool, `.dev.vars.example`, `.gitignore`.
2. **Provision:** set up Email Routing on `school.jasoncabot.com` pointing to the Worker, onboard Email Service sending, create the R2 bucket and its lifecycle rules, connect Workers Builds and add the secrets.
3. **Inbound:** `email()` handler with the auth check, raw mail to R2 and the address lookup.
4. **Verification:** signed link, holding pending mail, promoting it on verify.
5. **Processing:** MIME parsing, `toMarkdown` for attachments, AI extraction into `items`.
6. **Digest:** Sunday schedule, a short email built from next week's items, sent to all members.
7. **Web page:** magic-link sign-in; children and schools; household members; upcoming items; delete data.
8. **Owner trial:** the owner forwards real mail from both schools for a few weeks, then we tune the extraction and the digest copy.
