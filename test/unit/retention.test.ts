import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Address } from "../../src/address";
import { addressStub, householdStub } from "../../src/bindings";
import { handleInbound } from "../../src/email/inbound";
import { sha256Hex } from "../../src/email/sender";
import { EXTRACTION_MODEL, extractionRequest } from "../../src/extract/prompt";
import type { Household } from "../../src/household";
import { purgeTime } from "../../src/retention";
import { testDeps } from "../helpers/deps";
import { CLOUDFLARE_PASS, fakeMessage } from "../helpers/email";
import { mimeEmail } from "../helpers/mime";
import { registerAiRun } from "../helpers/stubs";

describe("purgeTime", () => {
  it("rounds up to the next midnight UTC, so a day's expiries share one wake-up", () => {
    expect(purgeTime("2025-10-13T08:00:00.000Z").toISOString()).toBe("2025-10-14T00:00:00.000Z");
    expect(purgeTime("2025-10-13T23:59:59.999Z").toISOString()).toBe("2025-10-14T00:00:00.000Z");
    expect(purgeTime("2025-10-14T00:00:00.000Z").toISOString()).toBe("2025-10-14T00:00:00.000Z");
  });
});

describe("household retention", () => {
  // Received 29 Sep 2025, so the original and its text go on 28 Dec 2025. The trip is on
  // 16 Oct 2025, so its item goes 90 days later, on 14 Jan 2026.
  const RECEIVED = "2025-09-29T15:11:00.000Z";

  async function processedHousehold(householdId: string) {
    const raw = mimeEmail({
      from: "parent@example.com",
      subject: `Trip (${householdId})`,
      text: "Year 3 trip on Thursday 16th October.",
      attachments: [{ filename: "old.doc", contentType: "application/msword", bytes: "old" }],
    });
    const key = `mail/${householdId}/m1.eml`;
    await env.MAIL.put(key, raw);
    await registerAiRun(
      EXTRACTION_MODEL,
      extractionRequest({
        sentAt: "2025-09-29T15:10:00.000Z",
        subject: `Trip (${householdId})`,
        text: "Year 3 trip on Thursday 16th October.",
        images: [],
        children: [],
      }),
      {
        response: {
          items: [
            {
              day: 16,
              month: 10,
              year: null,
              time: null,
              kind: "event",
              title: "Year 3 trip",
              cost: null,
              location: null,
              school: null,
              child: "Year 3",
              confidence: "high",
              for: [],
              maybe: [],
            },
          ],
        },
      },
    );
    const household = await householdStub(env, householdId);
    await household.receive({
      id: "m1",
      key,
      receivedAt: RECEIVED,
      expiresAt: "2025-12-28T15:11:00.000Z",
    });
    await runInDurableObject(household, (h: Household) =>
      h.processPending(testDeps(householdId, RECEIVED)),
    );
    return { household, key };
  }

  const purge = (household: DurableObjectStub<Household>, now: string) =>
    runInDurableObject(household, (h: Household) => h.purgeExpired(new Date(now)));

  it("is due at the earliest expiry, rounded up to midnight", async () => {
    const { household } = await processedHousehold("household-retention-due");
    expect(await household.purgeDue()).toBe("2025-12-29T00:00:00.000Z");
  });

  it("deletes the original, its text and notes after 90 days, but keeps items until 90 days after their date", async () => {
    const { household, key } = await processedHousehold("household-retention-purge");
    expect(await household.unreadable()).toHaveLength(1);

    expect(await purge(household, "2025-12-28T15:10:59.999Z")).toEqual({ messages: 0, items: 0 });
    expect(await purge(household, "2025-12-29T00:00:00.000Z")).toEqual({ messages: 1, items: 0 });
    expect(await household.messages()).toEqual([]);
    expect(await household.unreadable()).toEqual([]);
    expect(await env.MAIL.head(key)).toBeNull();
    expect((await household.items()).map((i) => i.title)).toEqual(["Year 3 trip"]);
    expect(await household.purgeDue()).toBe("2026-01-14T00:00:00.000Z");

    expect(await purge(household, "2026-01-14T00:00:00.000Z")).toEqual({ messages: 0, items: 1 });
    expect(await household.items()).toEqual([]);
    expect(await household.purgeDue()).toBeNull();
  });

  it("leaves no trace of a message's text once it has expired", async () => {
    const { household } = await processedHousehold("household-retention-text");
    await purge(household, "2025-12-29T00:00:00.000Z");
    const leftovers = await runInDurableObject(household, (_h: Household, state) =>
      state.storage.sql
        .exec("SELECT COUNT(*) AS n FROM messages WHERE body_text IS NOT NULL")
        .one(),
    );
    expect(leftovers).toEqual({ n: 0 });
  });
});

describe("held mail retention", () => {
  const forward = (sender: string) =>
    fakeMessage({
      to: "hello@school.example.com",
      headers: [CLOUDFLARE_PASS, ["From", sender]],
      body: `Letter for ${sender}`,
    });
  const purge = (address: DurableObjectStub<Address>, now: string) =>
    runInDurableObject(address, (a: Address) => a.purge(new Date(now)));

  it("deletes held mail after 7 days and forgets an address that never verified", async () => {
    const sender = "retention-unverified@example.com";
    await handleInbound(forward(sender), env, testDeps("retention unverified"));
    const address = addressStub(env, sender);
    const state = await address.lookup();
    const key = state.status === "pending" ? (state.pending[0]?.key ?? "") : "";
    expect(key.startsWith(`pending/${await sha256Hex(sender)}/`)).toBe(true);
    expect(await address.purgeDue()).toBe("2025-10-14T00:00:00.000Z");

    expect(await purge(address, "2025-10-13T07:59:59.999Z")).toEqual({
      deleted: 0,
      forgotten: false,
    });
    expect(await purge(address, "2025-10-14T00:00:00.000Z")).toEqual({
      deleted: 1,
      forgotten: true,
    });
    expect(await env.MAIL.head(key)).toBeNull();
    // Nothing left in storage at all (checked before lookup(), which recreates empty tables).
    const tables = await runInDurableObject(address, (_a: Address, s) =>
      s.storage.sql
        .exec(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'",
        )
        .one(),
    );
    expect(tables).toEqual({ n: 0 });
    expect(await address.lookup()).toEqual({ status: "unknown" });
  });

  it("keeps a verified address, deleting only mail that was left held", async () => {
    const sender = "retention-verified@example.com";
    const deps = testDeps("retention verified");
    await handleInbound(forward(sender), env, deps);
    const address = addressStub(env, sender);
    await address.link("household-retention-verified", "2025-10-06T09:00:00.000Z");
    expect(await purge(address, "2025-10-14T00:00:00.000Z")).toEqual({
      deleted: 1,
      forgotten: false,
    });
    expect(await address.lookup()).toMatchObject({ status: "verified", pending: [] });
  });

  it("an address forgotten after expiry starts afresh if it forwards again", async () => {
    const sender = "retention-again@example.com";
    const deps = testDeps("retention again");
    await handleInbound(forward(sender), env, deps);
    const address = addressStub(env, sender);
    await purge(address, "2025-10-14T00:00:00.000Z");
    deps.clock.set("2025-10-20T08:00:00.000Z");
    await handleInbound(forward(sender), env, deps);
    expect(await address.lookup()).toMatchObject({
      status: "pending",
      firstSeen: "2025-10-20T08:00:00.000Z",
    });
  });
});
