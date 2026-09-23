# CLAUDE.md

Guidance for agents working in this repository. Write in British English and keep it short.

## What this is

School Organiser: parents forward school emails to one address. Each week they get a short digest of what matters in the week ahead. Read these before you change anything:

- `docs/problem.md`: the problem we're solving
- `docs/vision.md`: what v1 is and isn't
- `docs/decisions.md`: settled decisions. Don't reopen them without asking.
- `docs/architecture.md`: how it fits together
- `docs/plan.md`: build order
- `docs/open-questions.md`: things still to decide with the owner, plus the privacy checklist

## Rules

- **Public repo. No secrets, ever.** Tokens, signing keys, real email addresses and real school or child names don't go in code, config, fixtures or commit messages. Secrets live in Workers Secrets (`wrangler secret put`), and local ones in `.dev.vars` (git-ignored).
- **Cloudflare only.** Don't use third-party services. npm libraries are fine where Cloudflare's own docs use them (e.g. `postal-mime`).
- **Don't invent features.** If something isn't in `docs/vision.md` or `docs/decisions.md`, add it to `docs/open-questions.md` and ask the owner.
- **Check current docs, not memory.** Cloudflare products (especially Email Service, which is in beta, and the Agents SDK) change quickly. Use the Cloudflare skills and the Cloudflare docs MCP (set up in `.claude/settings.json`) before relying on what you remember about an API.
- Record every new decision in `docs/decisions.md` (one line, dated).

## Cloudflare skills

This project enables the `cloudflare@cloudflare` plugin from `cloudflare/skills`. The relevant skills are `agents-sdk`, `durable-objects`, `cloudflare-email-service`, `wrangler` and `workers-best-practices`. The plugin also bundles the Cloudflare MCP server (API and current docs).

## Stack

TypeScript, Cloudflare Workers, Agents SDK (a SQLite-backed Durable Object per household), Workers AI, R2, Email Routing (inbound) and Email Service (outbound). Tests use Vitest with `@cloudflare/vitest-pool-workers`. Deploys go through Workers Builds on push to `main`.

## Conventions

- Dates are shown in UK format (`Mon 6 Oct`) and times in Europe/London.
- Digest copy is plain and brief: no preamble and no sign-off fluff.
