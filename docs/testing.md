# Testing

The suite runs in parallel, offline, and gives the same result every time.

## Tools

- Vitest with `@cloudflare/vitest-plugin`: tests run in `workerd` on Miniflare.
- Playwright against `wrangler dev`, locally only.
- ESLint (`typescript-eslint` strict, type-checked), Prettier and strict `tsc`.
- Istanbul coverage (V8 coverage doesn't work in `workerd`).

## Determinism rules

- **Time, ids and randomness** come from `Deps`. Tests use `testDeps(name)`: a fixed clock and a generator seeded from the test's name. ESLint rejects `Date.now()`, `new Date()`, `Math.random()`, `randomUUID()` and `getRandomValues()` outside `src/deps.ts`. Vitest fake timers don't reach R2, and `workerd` freezes time during I/O, so they aren't used.
- **No scheduled work.** `test/wrangler.test.jsonc` sets `SCHEDULED_WORK` to `"0"`, because an alarm runs with the real clock. Tests call `processPending(testDeps(…))`, `purgeExpired(now)` and `purge(now)` through `runInDurableObject`, and check `purgeDue()`.
- **No network.** `AI`, `EMAIL` and `RENDERER` are service bindings to the stub Worker in `test/stubs/`. The AI stub answers only requests a test registered, so a changed prompt fails loudly.
- **Fixed keys**, e.g. `test-signing-key-not-a-secret`.
- **Parallel and shuffled.** Storage is isolated per file; tests in a file use their own ids. `npm run test:shuffle` runs twice with seeds 1 and 2.
- **Distinct content per test.** Stub fixtures are keyed by content, so concurrent tests must send different content (tag the subject with the test name).

## Helpers

- `test/helpers/deps.ts`: `testDeps()`, `fixedClock()`.
- `test/helpers/stubs.ts`: `sentTo()`, `registerAiRun()`, `registerMarkdown()`, `registerRender()`.
- `test/helpers/mime.ts`: raw MIME emails, minimal `.pptx` files and one-page PDFs.
- `test/helpers/email.ts`: a fake inbound message and Cloudflare authentication headers.

## Playwright

- Runs a fresh `wrangler dev` with empty state each time, so tests use fixed addresses.
- Inbound mail is posted to `/cdn-cgi/local/email` with an `ARC-Authentication-Results` header, as Email Routing would add.
- Test-only routes, present only when `E2E_TEST_ROUTES` is `"1"` (test config only):
  - `GET /__test/outbox?to=` reads the email stub.
  - `POST /__test/ai` registers the AI stub's answer to one exact request (`extractionRequest()` builds it).
  - `POST /__test/week?address=&now=` runs the Sunday schedule (read waiting mail, send the digest) for that address's household as if at `now`.
- `journey.spec.ts` covers forward, confirm, Sunday, digest, web page and stop link. It uses dates in 2099 so the digest's year-long links stay valid; email arrival still uses the real clock.
- `baseURL` is `http://localhost:8787` to match `APP_ORIGIN`; form posts are checked against it.

## Choosing the model

`npm run eval:extraction` sends the fictional letters in `test/fixtures/letters/` to real models with the production request and scores them. It needs `CLOUDFLARE_ACCOUNT_ID` and a token with Workers AI access. Run it by hand before changing the prompt or model. When a real letter is misread, add a fictional version of it.

## Fixtures

Fictional only: made-up schools, children and `example.com` addresses. Never commit real mail.

## Commands

- `npm test`, `npm run test:shuffle`, `npm run test:coverage`
- `npm run test:e2e` builds assets, then runs Playwright. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if the installed Chromium doesn't match.
- `npm run lint`: ESLint, Prettier and `tsc` for both tsconfigs.
- `npm run check:ci`: types check, lint and shuffled tests (Workers Builds).
- `npm run check`: `check:ci` plus Playwright. Run before every push.

## Known noise

When a stub throws across RPC, `workerd` logs "uncaught exception" and "hung". Expected in the tests that check failures.
