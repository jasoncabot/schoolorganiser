import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { addressStub, householdStub } from "../../src/bindings";
import { handleInbound, mailboxFor } from "../../src/email/inbound";
import { sha256Hex } from "../../src/email/sender";
import { testDeps } from "../helpers/deps";
import { CLOUDFLARE_PASS, fakeMessage, MICROSOFT_365_NO_DMARC } from "../helpers/email";

const HELLO = "hello@school.example.com";
const PRIVACY = "privacy@school.example.com";

/** A forwarded letter from `sender`, with a unique body so R2 contents can be checked. */
function forwarded(sender: string, to = HELLO) {
  const body = `From: Parent <${sender}>\r\nSubject: Fwd: Harvest festival\r\n\r\nLetter for ${sender}`;
  return fakeMessage({
    from: sender,
    to,
    headers: [CLOUDFLARE_PASS, ["From", `Parent <${sender}>`]],
    body,
  });
}

async function r2Text(key: string): Promise<string | null> {
  const object = await env.MAIL.get(key);
  return object === null ? null : object.text();
}

describe("mailboxFor", () => {
  it("recognises hello and privacy, case-insensitively", () => {
    expect(mailboxFor(HELLO)).toBe("hello");
    expect(mailboxFor("Privacy@School.Example.com")).toBe("privacy");
    expect(mailboxFor("postmaster@school.example.com")).toBeNull();
  });
});

describe("privacy@", () => {
  it("forwards authenticated mail to the owner", async () => {
    const message = forwarded("privacy-ok@example.com", PRIVACY);
    await handleInbound(message, env, testDeps("privacy ok"));
    expect(message.forwarded).toEqual([env.PRIVACY_FORWARD_TO]);
  });

  it("forwards mail from a domain with no DMARC record when SPF aligns", async () => {
    const message = fakeMessage({
      to: PRIVACY,
      headers: [MICROSOFT_365_NO_DMARC, ["From", "Leader <leader@club.example.org>"]],
    });
    await handleInbound(message, env, testDeps("privacy no dmarc"));
    expect(message.forwarded).toEqual([env.PRIVACY_FORWARD_TO]);
  });

  it("drops mail from a domain with no DMARC record when nothing aligns", async () => {
    const message = fakeMessage({
      to: PRIVACY,
      headers: [MICROSOFT_365_NO_DMARC, ["From", "Someone <someone@other.example.com>"]],
    });
    await handleInbound(message, env, testDeps("privacy no dmarc unaligned"));
    expect(message.forwarded).toEqual([]);
  });

  it("drops unauthenticated mail", async () => {
    const message = fakeMessage({
      to: PRIVACY,
      headers: [
        ["Authentication-Results", "mx.cloudflare.net; spf=fail; dkim=none; dmarc=fail"],
        ["From", "x@example.com"],
      ],
    });
    await handleInbound(message, env, testDeps("privacy fail"));
    expect(message.forwarded).toEqual([]);
    expect(message.rejected).toEqual([]);
  });
});

describe("hello@", () => {
  it("holds mail from an unknown sender under pending/ for 7 days", async () => {
    const sender = "new-parent@example.com";
    const deps = testDeps("unknown sender");
    await handleInbound(forwarded(sender), env, deps);

    const key = `pending/${await sha256Hex(sender)}/${testDeps("unknown sender").ids.next()}.eml`;
    expect(await r2Text(key)).toContain(`Letter for ${sender}`);
    expect(await addressStub(env, sender).lookup()).toEqual({
      status: "pending",
      firstSeen: "2025-10-06T08:00:00.000Z",
      pending: [
        { key, receivedAt: "2025-10-06T08:00:00.000Z", expiresAt: "2025-10-13T08:00:00.000Z" },
      ],
    });
  });

  it("keeps holding further mail while the sender is unverified", async () => {
    const sender = "twice@example.com";
    const deps = testDeps("held twice");
    await handleInbound(forwarded(sender), env, deps);
    deps.clock.advance(60 * 60 * 1000);
    await handleInbound(forwarded(sender), env, deps);

    const state = await addressStub(env, sender).lookup();
    expect(state.status === "pending" ? state.pending.map((p) => p.receivedAt) : state).toEqual([
      "2025-10-06T08:00:00.000Z",
      "2025-10-06T09:00:00.000Z",
    ]);
  });

  it("identifies the sender by the From header, case-insensitively", async () => {
    const message = fakeMessage({
      from: "bounces@relay.example.net",
      to: HELLO,
      headers: [CLOUDFLARE_PASS, ["From", '"A Parent" <Mixed.Case@Example.com>']],
      body: "x",
    });
    await handleInbound(message, env, testDeps("from header"));
    expect((await addressStub(env, "mixed.case@example.com").lookup()).status).toBe("pending");
    expect((await addressStub(env, "bounces@relay.example.net").lookup()).status).toBe("unknown");
  });

  it("stores mail from a verified sender against their household for 90 days", async () => {
    const sender = "verified-parent@example.com";
    await addressStub(env, sender).link("household-verified-test", "2025-10-01T08:00:00.000Z");
    const deps = testDeps("verified sender");
    await handleInbound(forwarded(sender), env, deps);

    const id = testDeps("verified sender").ids.next();
    const key = `mail/household-verified-test/${id}.eml`;
    expect(await r2Text(key)).toContain(`Letter for ${sender}`);
    const household = await householdStub(env, "household-verified-test");
    expect(await household.messages()).toEqual([
      { id, key, receivedAt: "2025-10-06T08:00:00.000Z", expiresAt: "2026-01-04T08:00:00.000Z" },
    ]);
  });

  it("stores nothing when the sender isn't authenticated", async () => {
    const sender = "spoofed@example.com";
    const message = fakeMessage({
      to: HELLO,
      headers: [
        ["Authentication-Results", "mx.cloudflare.net; spf=fail; dkim=fail; dmarc=fail"],
        ["From", sender],
      ],
      body: "x",
    });
    await handleInbound(message, env, testDeps("spoofed"));
    expect((await addressStub(env, sender).lookup()).status).toBe("unknown");
  });

  it("stores nothing without exactly one From address", async () => {
    const message = fakeMessage({
      to: HELLO,
      headers: [CLOUDFLARE_PASS, ["From", "a-two@example.com, b-two@example.com"]],
      body: "x",
    });
    await handleInbound(message, env, testDeps("two senders"));
    expect((await addressStub(env, "a-two@example.com").lookup()).status).toBe("unknown");
    expect((await addressStub(env, "b-two@example.com").lookup()).status).toBe("unknown");
  });
});

describe("other mailboxes", () => {
  it("drops mail without replying or bouncing", async () => {
    const message = forwarded("someone@example.com", "sales@school.example.com");
    await handleInbound(message, env, testDeps("unknown mailbox"));
    expect(message.forwarded).toEqual([]);
    expect(message.replies).toBe(0);
    expect(message.rejected).toEqual([]);
    expect((await addressStub(env, "someone@example.com").lookup()).status).toBe("unknown");
  });
});

describe("logging", () => {
  it("never logs addresses", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await handleInbound(forwarded("log-test@example.com"), env, testDeps("log hello"));
    await handleInbound(forwarded("log-test@example.com", PRIVACY), env, testDeps("log privacy"));
    const logged = JSON.stringify(log.mock.calls);
    log.mockRestore();
    expect(logged).not.toContain("log-test@example.com");
    expect(logged).not.toContain(env.PRIVACY_FORWARD_TO);
    expect(logged).not.toContain("school.example.com");
  });
});
