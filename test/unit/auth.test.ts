import { describe, expect, it } from "vitest";
import { cloudflareAuthResults, senderIsAuthenticated } from "../../src/email/auth";
import { CLOUDFLARE_PASS } from "../helpers/email";

const headers = (...entries: [string, string][]): Headers => new Headers(entries);

describe("cloudflareAuthResults", () => {
  it("reads Cloudflare's ARC results", () => {
    expect(cloudflareAuthResults(headers(CLOUDFLARE_PASS))).toEqual({
      spf: "pass",
      dkim: "pass",
      dmarc: "pass",
    });
  });

  it("falls back to Authentication-Results from Cloudflare", () => {
    const results = cloudflareAuthResults(
      headers([
        "Authentication-Results",
        "mx.cloudflare.net; spf=fail smtp.mailfrom=x@example.com; dkim=none; dmarc=fail header.from=example.com",
      ]),
    );
    expect(results).toEqual({ spf: "fail", dkim: "none", dmarc: "fail" });
  });

  it("ignores results claimed by anyone else", () => {
    const forged = headers([
      "Authentication-Results",
      "mail.attacker.example; spf=pass; dkim=pass; dmarc=pass",
    ]);
    expect(cloudflareAuthResults(forged)).toBeNull();
  });

  it("trusts only the topmost value when a forged one follows", () => {
    const results = cloudflareAuthResults(
      headers(
        [
          "Authentication-Results",
          "mx.cloudflare.net; spf=fail smtp.mailfrom=x@example.com; dkim=fail; dmarc=fail",
        ],
        ["Authentication-Results", "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass"],
      ),
    );
    expect(results?.dmarc).toBe("fail");
  });

  it("ignores ARC results from a later hop", () => {
    const later = headers([
      "ARC-Authentication-Results",
      "i=2; mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass",
    ]);
    expect(cloudflareAuthResults(later)).toBeNull();
  });

  it("counts DKIM as passed if any signature passed", () => {
    const results = cloudflareAuthResults(
      headers([
        "Authentication-Results",
        "mx.cloudflare.net; dkim=fail header.d=a.example; dkim=pass header.d=example.com; dmarc=pass",
      ]),
    );
    expect(results?.dkim).toBe("pass");
  });

  it("returns null when there are no results", () => {
    expect(cloudflareAuthResults(headers())).toBeNull();
  });
});

describe("senderIsAuthenticated", () => {
  it("requires a DMARC pass", () => {
    expect(senderIsAuthenticated({ spf: "pass", dkim: "pass", dmarc: "pass" })).toBe(true);
    expect(senderIsAuthenticated({ spf: "pass", dkim: "pass", dmarc: "fail" })).toBe(false);
    expect(senderIsAuthenticated({ spf: "pass", dkim: "none", dmarc: "none" })).toBe(false);
    expect(senderIsAuthenticated(null)).toBe(false);
  });
});
