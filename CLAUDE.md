# CLAUDE.md

Guidance for agents working here. Follow `docs/style.md` for all writing.

School Organiser: parents forward school emails to one address and get a short summary each Sunday of what matters in the week ahead.

## Read first

- `docs/problem.md`, `docs/vision.md`: what we're building and what v1 includes
- `docs/decisions.md`: settled decisions; don't reopen them without asking
- `docs/architecture.md`, `docs/testing.md`, `docs/design.md`
- `docs/plan.md`: build order
- `docs/open-questions.md`: things to put to the owner
- `docs/runbook.md`: production resources
- `docs/privacy.md`: update it with any change to what we store or for how long

## Rules

- **Public repo, no secrets.** No tokens, keys, real addresses or real school or child names in code, config, fixtures or commits. Secrets go in Workers Secrets; local ones in `.dev.vars`.
- **Cloudflare only.** npm libraries are fine when Cloudflare's docs use them.
- **Don't invent features.** Anything not in `vision.md` or `decisions.md` goes to `open-questions.md` for the owner.
- **Check current docs, not memory.** Use the Cloudflare skills and docs MCP (`.claude/settings.json`) before relying on an API.
- **Deterministic tests.** Time, ids and randomness only through `Deps`; no network in tests (`testing.md`).
- **Keep decisions current.** Edit `decisions.md` when a decision changes.

## Workflow (until v1)

Work on `main`. Run `npm run check` before every push: it includes Playwright, which Workers Builds doesn't run.

## Commands

- `npm run check`: types, lint, shuffled unit tests, Playwright
- `npm run check:ci`: the same without Playwright (Workers Builds)
- `npm test`, `npm run test:e2e`, `npm run lint`, `npm run format`
- `npm run types` after changing `wrangler.jsonc`; keep `test/wrangler.test.jsonc` in step
- Install with npm 11 (`npx npm@11 install`); npm 10 fails with an `edgesOut` error when adding packages
