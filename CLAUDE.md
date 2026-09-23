# CLAUDE.md

Guidance for agents working in this repository. Write in British English and keep it short.

## What this is

School Organiser: parents forward school emails to one address. Each week they get a short digest of what matters in the week ahead. Read these before you change anything:

- `docs/problem.md`: the problem we're solving
- `docs/vision.md`: what v1 is and isn't
- `docs/decisions.md`: settled decisions. Don't reopen them without asking.
- `docs/architecture.md`: how it fits together
- `docs/plan.md`: build order
- `docs/open-questions.md`: things still to decide with the owner
- `docs/testing.md`: how we test. Determinism comes first.
- `docs/design.md`: web UI style
- `docs/runbook.md`: production resources and how they were set up
- `docs/privacy.md`: the privacy notice. Any change to what we store or how long we keep it must update this too.

## Rules

- **Public repo. No secrets, ever.** Tokens, signing keys, real email addresses and real school or child names don't go in code, config, fixtures or commit messages. Secrets live in Workers Secrets (`wrangler secret put`), and local ones in `.dev.vars` (git-ignored).
- **Cloudflare only.** Don't use third-party services. npm libraries are fine where Cloudflare's own docs use them (e.g. `postal-mime`).
- **Don't invent features.** If something isn't in `docs/vision.md` or `docs/decisions.md`, add it to `docs/open-questions.md` and ask the owner.
- **Check current docs, not memory.** Cloudflare products (especially Email Service, which is in beta, and the Agents SDK) change quickly. Use the Cloudflare skills and the Cloudflare docs MCP (set up in `.claude/settings.json`) before relying on what you remember about an API.
- **Deterministic tests.** Never read the clock or randomness directly: use the injected `Deps`. Never let tests reach Cloudflare's network: AI and email are stubbed.
- Record every new decision in `docs/decisions.md` (one line, dated).

## Cloudflare skills

This project enables the `cloudflare@cloudflare` plugin from `cloudflare/skills`. The relevant skills are `agents-sdk`, `durable-objects`, `cloudflare-email-service`, `wrangler` and `workers-best-practices`. The plugin also bundles the Cloudflare MCP server (API and current docs).

## Stack

TypeScript, Cloudflare Workers, Agents SDK (a SQLite-backed Durable Object per household), Workers AI, R2, Email Routing (inbound) and Email Service (outbound). The web UI uses Tailwind CSS v4. Tests use Vitest with `@cloudflare/vitest-plugin` and Playwright; linting uses ESLint and Prettier. Deploys go through Workers Builds on push to `main`, after `npm run check:ci`.

## Workflow (until v1)

There are no production users yet, so work directly on `main`: pull `main`, make the change, run `npm run check`, then push to `main`. We'll revisit branches and PRs at v1.

**Always run `npm run check` locally before pushing to `main`.** It includes the Playwright tests, which Workers Builds doesn't run, so this is the only place they catch problems before a deploy.

## Commands

- `npm run check`: runs types, lint, the shuffled unit tests and Playwright. Required before every push.
- `npm run check:ci`: the same without Playwright. This is what Workers Builds runs before deploying.
- `npm test`, `npm run test:e2e`, `npm run lint`, `npm run format`
- `npm run types`: run after changing `wrangler.jsonc`. Keep `test/wrangler.test.jsonc` in step with it.
- Use npm 11 (`npx npm@11 install`). npm 10 fails with an `edgesOut` error on this dependency tree.

## Conventions

- Dates are shown in UK format (`Mon 6 Oct`) and times in Europe/London.
- Digest copy is plain and brief: no preamble and no sign-off fluff.
