import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { householdStub } from "../../src/bindings";
import { readMessage } from "../../src/extract/message";
import { EXTRACTION_MODEL, extractionRequest } from "../../src/extract/prompt";
import { pdfRenderer } from "../../src/extract/render";
import { Household, MAX_ATTEMPTS, migrate } from "../../src/household";
import { testDeps } from "../helpers/deps";
import { mimeEmail, pdf } from "../helpers/mime";
import { registerAiRun, registerRender } from "../helpers/stubs";

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
  const message = await readMessage(
    new TextEncoder().encode(raw).buffer as ArrayBuffer,
    env.AI,
    pdfRenderer(env, testDeps("renderer")),
  );
  await registerAiRun(
    EXTRACTION_MODEL,
    extractionRequest({
      sentAt: message.sentAt ?? "",
      subject: message.subject,
      text: message.text,
      images: message.images,
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
  it("stores notes worth knowing, and keeps an unreadable file mentioned when re-read", async () => {
    const household = await received("household-notes", trip("household-notes"), {
      response: {
        items: TRIP_ITEMS,
        notes: [
          {
            text: "Bring a packed lunch in a named bag.",
            school: null,
            child: "Year 3",
            for: [],
            maybe: [],
          },
          { text: "   ", school: null, child: null, for: [], maybe: [] },
        ],
      },
    });
    await process(household, "notes");
    expect((await household.notes()).map((n) => [n.text, n.child, n.childIds])).toEqual([
      ["Bring a packed lunch in a named bag.", "Year 3", null],
    ]);
    const activity = (await household.activity())[0];
    expect(activity?.notes).toBe(1);
    expect(activity?.attachments).toEqual([{ filename: "old-form.doc", outcome: "unreadable" }]);

    await runInDurableObject(household, (_instance: Household, state) => {
      state.storage.sql.exec("UPDATE unreadable SET mentioned_at = '2025-10-05T17:00:00.000Z'");
      state.storage.sql.exec("UPDATE messages SET extraction_version = 1");
    });
    expect(await process(household, "notes again")).toEqual({ processed: 1, retry: false });
    const mentioned = await runInDurableObject(household, (_instance: Household, state) =>
      state.storage.sql
        .exec<{ at: string | null }>("SELECT mentioned_at AS at FROM unreadable")
        .toArray(),
    );
    expect(mentioned).toEqual([{ at: "2025-10-05T17:00:00.000Z" }]);
    expect(await household.notes()).toHaveLength(1);
  });

  it("extracts items, records unreadable files and marks the message done", async () => {
    const household = await received("household-process", trip("household-process"), {
      response: { items: TRIP_ITEMS },
    });
    expect(await process(household, "process")).toEqual({ processed: 1, retry: false });

    const source = {
      subject: "Fwd: Year 3 trip to Chester Zoo (household-process)",
      receivedAt: expect.any(String) as unknown,
    };
    expect(await household.items()).toEqual([
      {
        id: "m1-1",
        messageId: "m1",
        date: "2025-10-10",
        ...without(TRIP_ITEMS[1]),
        expiresAt: "2026-01-08T00:00:00.000Z",
        childIds: null,
        maybeChildIds: [],
        dateUnsure: false,
        source,
      },
      {
        id: "m1-0",
        messageId: "m1",
        date: "2025-10-16",
        ...without(TRIP_ITEMS[0]),
        expiresAt: "2026-01-14T00:00:00.000Z",
        childIds: null,
        maybeChildIds: [],
        dateUnsure: false,
        source,
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

describe("PDF page images", () => {
  it("sends rendered pages to the model with the text", async () => {
    const letter = pdf([
      {
        text: "Year 3 will visit Chester Zoo on Thursday 16th October. Cost £18.50 by 10th October.",
        x: 50,
        y: 520,
      },
      {
        text: "Children will need a packed lunch, a named water bottle and a waterproof coat.",
        x: 50,
        y: 505,
      },
    ]);
    await registerRender(letter, ["data:image/jpeg;base64,cGFnZQ=="]);
    const raw = mimeEmail({
      from: "parent@example.com",
      subject: "Fwd: Trip (images)",
      text: "See attached.",
      attachments: [{ filename: "trip.pdf", contentType: "application/pdf", bytes: letter }],
    });
    // The stub only answers a request that includes the page image, so this fails if it's dropped.
    const household = await received("household-process-images", raw, {
      response: { items: [TRIP_ITEMS[0]] },
    });
    await process(household, "images");
    expect((await household.items()).map((i) => i.title)).toEqual(["Year 3 trip to Chester Zoo"]);
  });
});

describe("which children each item is for", () => {
  const promptChildren = [
    { name: "Ada", school: "Oakfield Primary", yearGroup: "Year 3", className: "Oak" },
    { name: "Sam", school: "Riverside Juniors", yearGroup: "Reception", className: null },
  ];

  async function withChildren(householdId: string) {
    const household = await householdStub(env, householdId);
    await household.addChild(
      "child-ada",
      { name: "Ada", school: "Oakfield Primary", yearGroup: 3, className: "Oak" },
      2025,
      "2025-09-01T00:00:00.000Z",
    );
    await household.addChild(
      "child-sam",
      { name: "Sam", school: "Riverside Juniors", yearGroup: 0, className: null },
      2025,
      "2025-09-01T00:00:00.000Z",
    );
    return household;
  }

  async function register(
    raw: string,
    children: typeof promptChildren,
    output: unknown,
  ): Promise<void> {
    const message = await readMessage(
      new TextEncoder().encode(raw).buffer as ArrayBuffer,
      env.AI,
      pdfRenderer(env, testDeps("renderer")),
    );
    await registerAiRun(
      EXTRACTION_MODEL,
      extractionRequest({
        sentAt: message.sentAt ?? "",
        subject: message.subject,
        text: message.text,
        images: message.images,
        children,
      }),
      output,
    );
  }

  it("tells the model about the children and stores who each item is for", async () => {
    const householdId = "household-relevance";
    const household = await withChildren(householdId);
    const raw = trip(householdId);
    await register(raw, promptChildren, {
      response: {
        items: [
          { ...TRIP_ITEMS[0], for: ["ada"] },
          { ...TRIP_ITEMS[1], for: [] },
          {
            ...TRIP_ITEMS[1],
            day: 20,
            title: "Harvest festival",
            for: ["Ada", "Sam", "Somebody else"],
          },
        ],
      },
    });
    const key = `mail/${householdId}/m1.eml`;
    await env.MAIL.put(key, raw);
    await household.receive({
      id: "m1",
      key,
      receivedAt: "2025-09-29T15:11:00.000Z",
      expiresAt: "2025-12-28T15:11:00.000Z",
    });
    await process(household, "relevance");

    expect((await household.items()).map((i) => [i.title, i.childIds])).toEqual([
      ["Pay for Chester Zoo trip", []],
      ["Year 3 trip to Chester Zoo", ["child-ada"]],
      ["Harvest festival", ["child-ada", "child-sam"]],
    ]);
  });

  it("keeps children an item may apply to, e.g. for a class name we don't know", async () => {
    const householdId = "household-relevance-maybe";
    const household = await withChildren(householdId);
    const raw = trip(householdId);
    await register(raw, promptChildren, {
      response: {
        items: [
          { ...TRIP_ITEMS[0], title: "Oak class assembly", for: [], maybe: ["Ada", "Nobody"] },
        ],
      },
    });
    const key = `mail/${householdId}/m1.eml`;
    await env.MAIL.put(key, raw);
    await household.receive({
      id: "m1",
      key,
      receivedAt: "2025-09-29T15:11:00.000Z",
      expiresAt: "2025-12-28T15:11:00.000Z",
    });
    await process(household, "relevance maybe");
    expect((await household.items()).map((i) => [i.childIds, i.maybeChildIds])).toEqual([
      [[], ["child-ada"]],
    ]);
  });

  it("treats a class-named item as only a maybe for a child whose class we don't know", async () => {
    const householdId = "household-relevance-class";
    const household = await withChildren(householdId);
    const raw = trip(householdId);
    // The model wrongly put Sam (no class set) in "for"; Ada is in Oak class, so she's certain.
    await register(raw, promptChildren, {
      response: {
        items: [
          {
            ...TRIP_ITEMS[0],
            title: "Class assembly",
            child: "Oak class",
            for: ["Ada", "Sam"],
            maybe: [],
          },
        ],
      },
    });
    const key = `mail/${householdId}/m1.eml`;
    await env.MAIL.put(key, raw);
    await household.receive({
      id: "m1",
      key,
      receivedAt: "2025-09-29T15:11:00.000Z",
      expiresAt: "2025-12-28T15:11:00.000Z",
    });
    await process(household, "relevance class");
    expect((await household.items()).map((i) => [i.childIds, i.maybeChildIds])).toEqual([
      [["child-ada"], ["child-sam"]],
    ]);
  });

  it("re-reads stored mail when the children change", async () => {
    const householdId = "household-relevance-change";
    const household = await withChildren(householdId);
    const raw = trip(householdId);
    await register(raw, promptChildren, { response: { items: [{ ...TRIP_ITEMS[0], for: [] }] } });
    const key = `mail/${householdId}/m1.eml`;
    await env.MAIL.put(key, raw);
    await household.receive({
      id: "m1",
      key,
      receivedAt: "2025-09-29T15:11:00.000Z",
      expiresAt: "2025-12-28T15:11:00.000Z",
    });
    await process(household, "relevance change first");
    expect((await household.items()).map((i) => i.childIds)).toEqual([[]]);

    // Ada was actually in Year 3 at the school that sent it... well, now she's added as such.
    await household.removeChild("child-sam");
    await register(raw, promptChildren.slice(0, 1), {
      response: { items: [{ ...TRIP_ITEMS[0], for: ["Ada"] }] },
    });
    expect(await process(household, "relevance change again")).toEqual({
      processed: 1,
      retry: false,
    });
    expect((await household.items()).map((i) => i.childIds)).toEqual([["child-ada"]]);
    expect(await process(household, "relevance change settled")).toEqual({
      processed: 0,
      retry: false,
    });
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
