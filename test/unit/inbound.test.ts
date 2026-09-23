import { describe, expect, it, vi } from "vitest";
import { handleInbound, mailboxFor } from "../../src/email/inbound";
import { CLOUDFLARE_PASS, fakeMessage } from "../helpers/email";

const env = { PRIVACY_FORWARD_TO: "owner@example.com" };

describe("mailboxFor", () => {
  it("recognises hello and privacy, case-insensitively", () => {
    expect(mailboxFor("hello@school.example.com")).toBe("hello");
    expect(mailboxFor("Privacy@School.Example.com")).toBe("privacy");
    expect(mailboxFor("postmaster@school.example.com")).toBeNull();
  });
});

describe("handleInbound", () => {
  it("forwards authenticated privacy mail to the owner", async () => {
    const message = fakeMessage({ to: "privacy@school.example.com", headers: [CLOUDFLARE_PASS] });
    await handleInbound(message, env);
    expect(message.forwarded).toEqual(["owner@example.com"]);
  });

  it("drops unauthenticated privacy mail", async () => {
    const message = fakeMessage({
      to: "privacy@school.example.com",
      headers: [["Authentication-Results", "mx.cloudflare.net; spf=fail; dkim=none; dmarc=fail"]],
    });
    await handleInbound(message, env);
    expect(message.forwarded).toEqual([]);
    expect(message.rejected).toEqual([]);
  });

  it("drops mail with no Cloudflare results", async () => {
    const message = fakeMessage({ to: "privacy@school.example.com" });
    await handleInbound(message, env);
    expect(message.forwarded).toEqual([]);
  });

  it("drops mail for unknown mailboxes without replying", async () => {
    const message = fakeMessage({ to: "sales@school.example.com", headers: [CLOUDFLARE_PASS] });
    await handleInbound(message, env);
    expect(message.forwarded).toEqual([]);
    expect(message.replies).toBe(0);
    expect(message.rejected).toEqual([]);
  });

  it("accepts hello mail without forwarding it", async () => {
    const message = fakeMessage({ to: "hello@school.example.com", headers: [CLOUDFLARE_PASS] });
    await handleInbound(message, env);
    expect(message.forwarded).toEqual([]);
  });

  it("never logs addresses", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const message = fakeMessage({
      from: "parent-log-test@example.com",
      to: "privacy@school.example.com",
      headers: [CLOUDFLARE_PASS],
    });
    await handleInbound(message, env);
    const logged = JSON.stringify(log.mock.calls);
    log.mockRestore();
    expect(logged).not.toContain("parent-log-test@example.com");
    expect(logged).not.toContain("owner@example.com");
    expect(logged).not.toContain("privacy@school.example.com");
  });
});
