import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "../../src/tokens";

const KEY = "test-signing-key-not-a-secret";
const NOW = new Date("2025-10-06T08:00:00.000Z");
const payload = {
  purpose: "verify",
  address: "a@example.com",
  expires: "2025-10-13T08:00:00.000Z",
};

describe("tokens", () => {
  it("round-trips a payload", async () => {
    const token = await signToken(payload, KEY);
    expect(await verifyToken(token, "verify", KEY, NOW)).toEqual(payload);
  });

  it("is deterministic for the same payload and key", async () => {
    expect(await signToken(payload, KEY)).toBe(await signToken(payload, KEY));
  });

  it("refuses a token signed with another key", async () => {
    const token = await signToken(payload, "another-key");
    expect(await verifyToken(token, "verify", KEY, NOW)).toBeNull();
  });

  it("refuses a tampered payload", async () => {
    const token = await signToken(payload, KEY);
    const [v, , sig] = token.split(".");
    const forged = btoa(JSON.stringify({ ...payload, address: "attacker@example.com" }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    expect(await verifyToken(`${v ?? ""}.${forged}.${sig ?? ""}`, "verify", KEY, NOW)).toBeNull();
  });

  it("refuses a token for another purpose", async () => {
    const token = await signToken({ ...payload, purpose: "sign-in" }, KEY);
    expect(await verifyToken(token, "verify", KEY, NOW)).toBeNull();
  });

  it("refuses an expired token, including at the exact expiry time", async () => {
    const token = await signToken(payload, KEY);
    expect(await verifyToken(token, "verify", KEY, new Date(payload.expires))).toBeNull();
    expect(
      await verifyToken(token, "verify", KEY, new Date("2025-10-13T07:59:59.999Z")),
    ).not.toBeNull();
  });

  it("refuses rubbish", async () => {
    for (const junk of ["", "v1", "v1..", "v2.a.b", "v1.!!.??", "v1.a.b.c"]) {
      expect(await verifyToken(junk, "verify", KEY, NOW)).toBeNull();
    }
  });
});
