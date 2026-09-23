import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addressStub, householdStub } from "../../src/bindings";
import { handleInbound } from "../../src/email/inbound";
import { sha256Hex } from "../../src/email/sender";
import { handleRequest } from "../../src/web/routes";
import { testDeps } from "../helpers/deps";
import { CLOUDFLARE_PASS, fakeMessage } from "../helpers/email";
import { sentTo } from "../helpers/stubs";

const DAY = 24 * 60 * 60 * 1000;

function forward(sender: string, body = `Letter for ${sender}`) {
  return fakeMessage({
    from: sender,
    to: "hello@school.example.com",
    headers: [CLOUDFLARE_PASS, ["From", `Parent <${sender}>`]],
    body,
  });
}

/** The verification link from the latest email the stub sent to `address`. */
async function latestLink(address: string): Promise<string> {
  const sent = await sentTo(address);
  const link = /https?:\/\/\S+\/verify\?token=\S+/.exec(sent.at(-1)?.text ?? "")?.[0];
  if (link === undefined) throw new Error(`No verification link sent to ${address}`);
  return link;
}

async function post(link: string, deps: ReturnType<typeof testDeps>): Promise<Response> {
  const token = new URL(link).searchParams.get("token") ?? "";
  return handleRequest(
    new Request("http://localhost:8787/verify", {
      method: "POST",
      body: new URLSearchParams({ token }),
    }),
    env,
    deps,
  );
}

describe("verification email", () => {
  it("goes to an unknown sender from the no-reply address", async () => {
    const sender = "verify-first@example.com";
    await handleInbound(forward(sender), env, testDeps("verify first"));

    const sent = await sentTo(sender);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.from).toEqual({
      email: "no-reply@school.example.com",
      name: "School Organiser",
    });
    expect(sent[0]?.subject).toBe("Confirm your email for School Organiser");
    expect(sent[0]?.text).toContain("This link works until Mon 13 Oct.");
  });

  it("is sent at most once a day", async () => {
    const sender = "verify-daily@example.com";
    const deps = testDeps("verify daily");
    await handleInbound(forward(sender), env, deps);
    deps.clock.advance(DAY - 1);
    await handleInbound(forward(sender), env, deps);
    expect(await sentTo(sender)).toHaveLength(1);

    deps.clock.advance(1);
    await handleInbound(forward(sender), env, deps);
    expect(await sentTo(sender)).toHaveLength(2);
  });

  it("isn't sent to a verified sender", async () => {
    const sender = "verify-already@example.com";
    await addressStub(env, sender).link("household-already", "2025-10-01T08:00:00.000Z");
    await handleInbound(forward(sender), env, testDeps("verify already"));
    expect(await sentTo(sender)).toEqual([]);
  });

  it("isn't sent when the sender fails authentication", async () => {
    const sender = "verify-spoofed@example.com";
    const message = fakeMessage({
      to: "hello@school.example.com",
      headers: [
        ["Authentication-Results", "mx.cloudflare.net; spf=fail; dkim=fail; dmarc=fail"],
        ["From", sender],
      ],
    });
    await handleInbound(message, env, testDeps("verify spoofed"));
    expect(await sentTo(sender)).toEqual([]);
  });
});

describe("/verify", () => {
  it("shows a confirm button on GET and changes nothing", async () => {
    const sender = "verify-get@example.com";
    const deps = testDeps("verify get");
    await handleInbound(forward(sender), env, deps);
    const link = await latestLink(sender);

    const response = await handleRequest(new Request(link), env, deps);
    const body = (await response.text()).replace(/\s+/g, " ");
    expect(response.status).toBe(200);
    expect(body).toContain("Confirm your email");
    expect(body).toContain(sender);
    expect(body).toContain('<form method="post" action="/verify">');
    expect(body).toContain('href="/privacy"');
    expect((await addressStub(env, sender).lookup()).status).toBe("pending");
  });

  it("verifies on POST, creates a household and moves held mail into it", async () => {
    const sender = "verify-post@example.com";
    const deps = testDeps("verify post");
    await handleInbound(forward(sender, "first letter"), env, deps);
    deps.clock.advance(60 * 60 * 1000);
    await handleInbound(forward(sender, "second letter"), env, deps);
    const held = await addressStub(env, sender).lookup();
    const heldKeys = held.status === "pending" ? held.pending.map((p) => p.key) : [];
    expect(heldKeys).toHaveLength(2);

    deps.clock.advance(DAY);
    const response = await post(await latestLink(sender), deps);
    const body = (await response.text()).replace(/\s+/g, " ");
    expect(response.status).toBe(200);
    expect(body).toContain("<h1>You're all set</h1>");
    expect(body).toContain("We've added the 2 emails you already sent.");

    const state = await addressStub(env, sender).lookup();
    expect(state).toMatchObject({
      status: "verified",
      verifiedAt: "2025-10-07T09:00:00.000Z",
      pending: [],
    });
    const householdId = state.status === "verified" ? state.householdId : "";
    const household = await householdStub(env, householdId);
    expect(await household.members()).toEqual([
      { address: sender, joinedAt: "2025-10-07T09:00:00.000Z", digestStoppedAt: null },
    ]);

    const messages = await household.messages();
    expect(messages.map((m) => [m.receivedAt, m.expiresAt])).toEqual([
      ["2025-10-06T08:00:00.000Z", "2026-01-04T08:00:00.000Z"],
      ["2025-10-06T09:00:00.000Z", "2026-01-04T09:00:00.000Z"],
    ]);
    for (const m of messages) expect(m.key.startsWith(`mail/${householdId}/`)).toBe(true);
    expect(await (await env.MAIL.get(messages[0]?.key ?? ""))?.text()).toContain("first letter");
    for (const key of heldKeys) expect(await env.MAIL.head(key)).toBeNull();
  });

  it("stores later mail straight into the household", async () => {
    const sender = "verify-later@example.com";
    const deps = testDeps("verify later");
    await handleInbound(forward(sender), env, deps);
    await post(await latestLink(sender), deps);
    await handleInbound(forward(sender, "after verifying"), env, deps);

    const state = await addressStub(env, sender).lookup();
    const household = await householdStub(
      env,
      state.status === "verified" ? state.householdId : "",
    );
    expect(await household.messages()).toHaveLength(2);
    expect(await sentTo(sender)).toHaveLength(1);
  });

  it("is safe to confirm twice", async () => {
    const sender = "verify-twice@example.com";
    const deps = testDeps("verify twice");
    await handleInbound(forward(sender), env, deps);
    const link = await latestLink(sender);
    await post(link, deps);
    const first = await addressStub(env, sender).lookup();
    const again = await post(link, deps);
    expect(again.status).toBe(200);
    expect(await addressStub(env, sender).lookup()).toEqual(first);
  });

  it("refuses an expired link", async () => {
    const sender = "verify-expired@example.com";
    const deps = testDeps("verify expired");
    await handleInbound(forward(sender), env, deps);
    deps.clock.advance(7 * DAY);
    const response = await post(await latestLink(sender), deps);
    expect(response.status).toBe(400);
    expect((await addressStub(env, sender).lookup()).status).toBe("pending");
  });

  it("refuses a missing or forged token", async () => {
    const deps = testDeps("verify forged");
    for (const url of [
      "http://localhost:8787/verify",
      "http://localhost:8787/verify?token=v1.e30.AAAA",
    ]) {
      const response = await handleRequest(new Request(url), env, deps);
      expect(response.status).toBe(400);
      await response.text();
    }
  });

  it("keeps held mail keyed by a hash of the address, never the address", async () => {
    const sender = "verify-hash@example.com";
    await handleInbound(forward(sender), env, testDeps("verify hash"));
    const state = await addressStub(env, sender).lookup();
    const key = state.status === "pending" ? (state.pending[0]?.key ?? "") : "";
    expect(key.startsWith(`pending/${await sha256Hex(sender)}/`)).toBe(true);
    expect(key).not.toContain("example.com");
  });
});
