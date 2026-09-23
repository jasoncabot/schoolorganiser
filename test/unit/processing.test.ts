import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { householdStub } from "../../src/bindings";
import { readMessage } from "../../src/extract/message";
import { EXTRACTION_MODEL, extractionRequest } from "../../src/extract/prompt";
import { Household, MAX_ATTEMPTS, migrate } from "../../src/household";
import { testDeps } from "../helpers/deps";
import { mimeEmail } from "../helpers/mime";
import { registerAiRun } from "../helpers/stubs";

/** The trip letter, tagged so each test's model request (and so its fixture) is unique. */
const trip = (tag: string): string =>
  mimeEmail({
    from: "parent@example.com",
    subject: `Fwd: Year 3 trip to Chester Zoo (${tag})`,
    text: "Year 3 will visit Chester Zoo on Thursday 16th October. The cost is £18.50, due by Friday 10th October.",
    attachments: [
      { filename: "old-form.doc", contentType: "application/msword", bytes: "old doc" },
    ],
  });

const TRIP_ITEMS = [
  {
    day: 16,
    month: 10,
    year: null,
    time: "08:15",
    kind: "event",
    title: "Year 3 trip to Chester Zoo",
    cost: null,
    location: "Chester Zoo",
    school: null,
    child: "Year 3",
    confidence: "high",
  },
  {
    day: 10,
    month: 10,
    year: null,
    time: null,
    kind: "payment",
    title: "Pay for Chester Zoo trip",
    cost: "£18.50",
    location: null,
    school: null,
    child: "Year 3",
    confidence: "high",
  },
];

/** An item as stored: the model's day/month/year become a resolved date. */
function without(item: (typeof TRIP_ITEMS)[number] | undefined) {
  if (item === undefined) throw new Error("missing item");
  const { time, kind, title, cost, location, school, child, confidence } = item;
  return { time, kind, title, cost, location, school, child, confidence };
}

/** Stores `raw` for a household as the inbound handler would, and registers the model's answer. */
async function received(
  householdId: string,
  raw: string,
  modelOutput: unknown,
): Promise<DurableObjectStub<Household>> {
  const key = `mail/${householdId}/m1.eml`;
  await env.MAIL.put(key, raw);
  const message = await readMessage(new TextEncoder().encode(raw).buffer as ArrayBuffer, env.AI);
  await registerAiRun(
    EXTRACTION_MODEL,
    extractionRequest({
      sentAt: message.sentAt ?? "",
      subject: message.subject,
      text: message.text,
    }),
    modelOutput,
  );
  const household = await householdStub(env, householdId);
  await household.receive({
    id: "m1",
    key,
    receivedAt: "2025-09-29T15:11:00.000Z",
    expiresAt: "2025-12-28T15:11:00.000Z",
  });
  return household;
}

const process = (household: DurableObjectStub<Household>, name: string) =>
  runInDurableObject(household, (instance: Household) =>
    instance.processPending(testDeps(name, "2025-09-29T15:12:00.000Z")),
  );

describe("processing", () => {
  it("extracts items, records unreadable files and marks the message done", async () => {
    const household = await received("household-process", trip("household-process"), {
      response: { items: TRIP_ITEMS },
    });
    expect(await process(household, "process")).toEqual({ processed: 1, retry: false });

    expect(await household.items()).toEqual([
      {
        id: "m1-1",
        messageId: "m1",
        date: "2025-10-10",
        ...without(TRIP_ITEMS[1]),
        expiresAt: "2026-01-08T00:00:00.000Z",
      },
      {
        id: "m1-0",
        messageId: "m1",
        date: "2025-10-16",
        ...without(TRIP_ITEMS[0]),
        expiresAt: "2026-01-14T00:00:00.000Z",
      },
    ]);
    expect(await household.unreadable()).toEqual([
      { messageId: "m1", filename: "old-form.doc", reason: "unsupported format" },
    ]);
    expect(await household.messages()).toMatchObject([
      {
        id: "m1",
        status: "done",
        subject: "Fwd: Year 3 trip to Chester Zoo (household-process)",
        attempts: 0,
      },
    ]);
  });

  it("does nothing the second time", async () => {
    const household = await received("household-process-twice", trip("household-process-twice"), {
      response: { items: TRIP_ITEMS },
    });
    await process(household, "twice");
    expect(await process(household, "twice again")).toEqual({ processed: 0, retry: false });
    expect(await household.items()).toHaveLength(2);
  });

  it("accepts answers in OpenAI-style choices or as a JSON string", async () => {
    const household = await received(
      "household-process-choices",
      trip("household-process-choices"),
      {
        choices: [
          { message: { content: `Here you go: ${JSON.stringify({ items: [TRIP_ITEMS[0]] })}` } },
        ],
      },
    );
    await process(household, "choices");
    expect((await household.items()).map((i) => i.title)).toEqual(["Year 3 trip to Chester Zoo"]);
  });

  it("drops items the model got wrong but keeps the rest", async () => {
    const household = await received(
      "household-process-bad-items",
      trip("household-process-bad-items"),
      {
        response: {
          items: [
            TRIP_ITEMS[0],
            { ...TRIP_ITEMS[1], day: 30, month: 2 },
            { ...TRIP_ITEMS[1], day: "tenth" },
            { ...TRIP_ITEMS[1], title: "" },
            { ...TRIP_ITEMS[1], kind: "banana", time: "25:00", cost: "null" },
          ],
        },
      },
    );
    await process(household, "bad items");
    expect(await household.items()).toMatchObject([
      { title: "Pay for Chester Zoo trip", kind: "other", time: null, cost: null },
      { title: "Year 3 trip to Chester Zoo", kind: "event" },
    ]);
  });

  it(`retries an unusable answer and gives up after ${String(MAX_ATTEMPTS)} attempts`, async () => {
    const household = await received(
      "household-process-unusable",
      trip("household-process-unusable"),
      {
        response: "Sorry, I can't help.",
      },
    );
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      expect(await process(household, `unusable ${String(attempt)}`)).toEqual({
        processed: 1,
        retry: true,
      });
      expect(await household.messages()).toMatchObject([{ status: "new", attempts: attempt }]);
    }
    expect(await process(household, "unusable last")).toEqual({ processed: 1, retry: false });
    expect(await household.messages()).toMatchObject([
      { status: "failed", attempts: MAX_ATTEMPTS },
    ]);
    expect(await household.items()).toEqual([]);
  });

  it("marks a message whose original has gone as failed", async () => {
    const household = await householdStub(env, "household-process-gone");
    await household.receive({
      id: "gone",
      key: "mail/household-process-gone/gone.eml",
      receivedAt: "2025-09-29T15:11:00.000Z",
      expiresAt: "2025-12-28T15:11:00.000Z",
    });
    await process(household, "gone");
    expect(await household.messages()).toMatchObject([{ id: "gone", status: "failed" }]);
  });

  it("doesn't call the model for an email with no text", async () => {
    const household = await householdStub(env, "household-process-empty");
    const key = "mail/household-process-empty/empty.eml";
    await env.MAIL.put(key, mimeEmail({ from: "p@example.com", subject: "Empty" }));
    await household.receive({
      id: "empty",
      key,
      receivedAt: "2025-09-29T15:11:00.000Z",
      expiresAt: "2025-12-28T15:11:00.000Z",
    });
    await process(household, "empty");
    expect(await household.messages()).toMatchObject([{ id: "empty", status: "done" }]);
  });
});

describe("Household migrations", () => {
  it("adds processing columns to messages stored before processing existed", async () => {
    const household = await householdStub(env, "household-migration");
    const columns = await runInDurableObject(household, (_instance: Household, state) => {
      state.storage.sql.exec(`
        DROP TABLE IF EXISTS messages;
        CREATE TABLE messages (id TEXT PRIMARY KEY, r2_key TEXT NOT NULL, received_at TEXT NOT NULL, expires_at TEXT NOT NULL);
        INSERT INTO messages VALUES ('old', 'mail/x/old.eml', '2025-09-23T11:06:51.000Z', '2025-12-22T11:06:51.000Z');
      `);
      migrate(state.storage.sql);
      migrate(state.storage.sql);
      return state.storage.sql.exec("SELECT status, attempts FROM messages WHERE id = 'old'").one();
    });
    expect(columns).toEqual({ status: "new", attempts: 0 });
  });
});

describe("extraction versions", () => {
  it("re-reads messages processed by an older version, replacing their items", async () => {
    const household = await received(
      "household-process-version",
      trip("household-process-version"),
      {
        response: { items: TRIP_ITEMS },
      },
    );
    await process(household, "version first");
    await runInDurableObject(household, (_instance: Household, state) => {
      state.storage.sql.exec("UPDATE messages SET extraction_version = 1");
    });
    expect(await process(household, "version again")).toEqual({ processed: 1, retry: false });
    expect(await household.items()).toHaveLength(2);
    expect(await process(household, "version current")).toEqual({ processed: 0, retry: false });
  });
});
