# Writing style

Applies to docs, code comments, UI copy, emails and commit messages.

## Principles

- **Facts, not claims.** Say what something does, what it costs, what it limits. Prefer a number to an adjective: "about 3 seconds", not "fast".
- **British English.** organise, colour, licence (noun), programme (not code), centre. Dates as `Mon 6 Oct`, times as `2pm` or `14:00`, money as `£18.50`.
- **Short.** One idea per sentence. Cut words that don't change the meaning.
- **Once.** Say each thing in one place and link to it. Decisions live in `decisions.md`, how things fit in `architecture.md`, how to test in `testing.md`.
- **Current.** Describe how things are. Delete superseded text rather than adding "now" or "previously"; git has the history.
- **Plain words.** use, start, help, check, show, need.

## Avoid

- Filler: "it's worth noting", "in order to", "simply", "just", "basically", "actually", "very", "really".
- Hype: robust, seamless, powerful, comprehensive, cutting-edge, game-changing, world-class.
- Inflated verbs: leverage, utilise, delve, streamline, elevate, unlock, empower, facilitate.
- Stock phrases: "a wide range of", "plays a key role", "at the end of the day", "navigate the landscape", "the journey".
- Rhetorical questions, exclamation marks, emoji, and triplets used only for rhythm.
- Hedging stacks: "may potentially help to".
- Restating the heading in the first sentence.

## Code comments

- Explain why, or a constraint the code can't show. Don't narrate what the next line does.
- Name the source of a surprising rule (a Cloudflare limit, a test that caught it).
- No history, no apologies, no TODO without a plan step.

## Docs

- Present tense. Lists and short sections over long paragraphs.
- Tables only when the columns help; don't pad cells.

## UI and email copy

- Second person, sentence-case headings, no preamble or sign-off.
- Say what happens next and when: "The link works for 30 minutes."
- Error messages say how to fix it: "Enter an email address, like name@example.com".

## Commit messages

- Imperative subject under 72 characters: "Add retention alarms", not "Added" or "Adds".
- Body only when the why isn't obvious.
