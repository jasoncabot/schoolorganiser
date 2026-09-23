import { describe, expect, it } from "vitest";
import type { AuthResults } from "../../src/email/auth";
import { cloudflareAuthResults, senderIsAuthenticated } from "../../src/email/auth";
import { CLOUDFLARE_PASS, MICROSOFT_365_NO_DMARC } from "../helpers/email";

const headers = (...entries: [string, string][]): Headers => new Headers(entries);

const results = (overrides: Partial<AuthResults>): AuthResults => ({
  spf: "none",
  dkim: "none",
  dmarc: "none",
  spfDomain: null,
  dkimDomains: [],
  ...overrides,
});

describe("cloudflareAuthResults", () => {
  it("reads Cloudflare's ARC results, with the passing domains", () => {
    expect(cloudflareAuthResults(headers(CLOUDFLARE_PASS))).toEqual({
      spf: "pass",
      dkim: "pass",
      dmarc: "pass",
      spfDomain: "example.com",
      dkimDomains: ["example.com"],
    });
  });

  it("reads a domain with no DMARC record", () => {
    expect(cloudflareAuthResults(headers(MICROSOFT_365_NO_DMARC))).toEqual({
      spf: "pass",
      dkim: "pass",
      dmarc: "none",
      spfDomain: "club.example.org",
      dkimDomains: ["clubexample.onmicrosoft.com"],
    });
  });

  it("falls back to Authentication-Results from Cloudflare", () => {
    const parsed = cloudflareAuthResults(
      headers([
        "Authentication-Results",
        "mx.cloudflare.net; spf=fail smtp.mailfrom=x@example.com; dkim=none; dmarc=fail header.from=example.com",
      ]),
    );
    expect(parsed).toEqual(results({ spf: "fail", dmarc: "fail" }));
  });

  it("ignores results claimed by anyone else", () => {
    const forged = headers([
      "Authentication-Results",
      "mail.attacker.example; spf=pass; dkim=pass; dmarc=pass",
    ]);
    expect(cloudflareAuthResults(forged)).toBeNull();
  });

  it("trusts only the topmost value when a forged one follows", () => {
    const parsed = cloudflareAuthResults(
      headers(
        [
          "Authentication-Results",
          "mx.cloudflare.net; spf=fail smtp.mailfrom=x@example.com; dkim=fail; dmarc=fail",
        ],
        ["Authentication-Results", "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass"],
      ),
    );
    expect(parsed?.dmarc).toBe("fail");
  });

  it("ignores ARC results from a later hop", () => {
    const later = headers([
      "ARC-Authentication-Results",
      "i=2; mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass",
    ]);
    expect(cloudflareAuthResults(later)).toBeNull();
  });

  it("keeps every passing DKIM domain and ignores failing ones", () => {
    const parsed = cloudflareAuthResults(
      headers([
        "Authentication-Results",
        "mx.cloudflare.net; dkim=fail header.d=bad.example; dkim=pass header.d=Example.com; dkim=pass header.d=esp.example.net; dmarc=pass",
      ]),
    );
    expect(parsed?.dkim).toBe("pass");
    expect(parsed?.dkimDomains).toEqual(["example.com", "esp.example.net"]);
  });

  it("returns null when there are no results", () => {
    expect(cloudflareAuthResults(headers())).toBeNull();
  });
});

describe("senderIsAuthenticated", () => {
  it("accepts a DMARC pass", () => {
    expect(senderIsAuthenticated(results({ dmarc: "pass" }), "example.com")).toBe(true);
  });

  it("rejects a DMARC fail even when SPF and DKIM pass and align", () => {
    const failed = results({
      spf: "pass",
      dkim: "pass",
      dmarc: "fail",
      spfDomain: "example.com",
      dkimDomains: ["example.com"],
    });
    expect(senderIsAuthenticated(failed, "example.com")).toBe(false);
  });

  describe("when the domain has no DMARC record", () => {
    it("accepts SPF passing for the From domain", () => {
      const r = results({ spf: "pass", spfDomain: "club.example.org" });
      expect(senderIsAuthenticated(r, "club.example.org")).toBe(true);
    });

    it("accepts DKIM passing for the From domain or a subdomain", () => {
      expect(
        senderIsAuthenticated(
          results({ dkim: "pass", dkimDomains: ["mail.example.org"] }),
          "example.org",
        ),
      ).toBe(true);
      expect(
        senderIsAuthenticated(
          results({ dkim: "pass", dkimDomains: ["example.org"] }),
          "news.example.org",
        ),
      ).toBe(true);
    });

    it("rejects passes for someone else's domain", () => {
      const r = results({
        spf: "pass",
        dkim: "pass",
        spfDomain: "bulk-mailer.example.net",
        dkimDomains: ["clubexample.onmicrosoft.com"],
      });
      expect(senderIsAuthenticated(r, "club.example.org")).toBe(false);
    });

    it("rejects look-alike domains", () => {
      const r = results({ spf: "pass", spfDomain: "notexample.org" });
      expect(senderIsAuthenticated(r, "example.org")).toBe(false);
    });

    it("rejects when nothing passed", () => {
      expect(senderIsAuthenticated(results({}), "example.org")).toBe(false);
    });
  });

  it("rejects missing results or a missing From domain", () => {
    expect(senderIsAuthenticated(null, "example.com")).toBe(false);
    expect(senderIsAuthenticated(results({ spf: "pass", spfDomain: "example.com" }), null)).toBe(
      false,
    );
  });
});
