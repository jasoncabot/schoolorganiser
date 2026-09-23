# Build plan

Each step ships with tests and deploys through Workers Builds.

1. Scaffold. **Done.**
2. Provision Cloudflare resources (`runbook.md`). **Done.**
3. Inbound mail: sender check, R2, address lookup. **Done.**
4. Verification: signed link, held mail moved on confirm. **Done.**
5. Processing: parsing, attachments, extraction. **Done.**
6. Sign-in, children, invitations, PDF page images, relevance. **Done.**
7. Retention: deletion at expiry. **Done.**
8. Digest: the Sunday email to every member, with a stop link. **Done.**
9. Rest of the web page: upcoming items, restart a stopped digest, leave, delete data. **Done.**
10. Playwright journey from forward to digest. **Done.**
11. Owner trial with real mail from both schools; tune extraction and digest copy. **Next.**
12. Automatic forwarding rules.
13. Before other parents join: privacy notice and retention checked in production.
14. After v1: ask questions on the web page.
