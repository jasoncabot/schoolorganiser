import { describe, expect, it } from "vitest";
import { ukDate, verificationEmail } from "../../src/email/outbound";

describe("ukDate", () => {
  it("formats in UK time across the clock changes", () => {
    expect(ukDate(new Date("2025-10-13T08:00:00.000Z"))).toBe("Mon 13 Oct");
    // 23:30 UTC on Sat 25 Oct 2025 is 00:30 BST on Sun 26 Oct.
    expect(ukDate(new Date("2025-10-25T23:30:00.000Z"))).toBe("Sun 26 Oct");
    // 23:30 UTC on Sat 1 Nov 2025 is still Sat in GMT.
    expect(ukDate(new Date("2025-11-01T23:30:00.000Z"))).toBe("Sat 1 Nov");
  });

  it("uses three-letter months, including Sep", () => {
    expect(ukDate(new Date("2026-09-30T12:00:00.000Z"))).toBe("Wed 30 Sep");
  });
});

describe("verificationEmail", () => {
  const email = verificationEmail({
    link: "https://school.example.com/verify?token=abc",
    expires: new Date("2025-10-13T08:00:00.000Z"),
    appOrigin: "https://school.example.com",
  });

  it("has a plain-text part with the link and expiry", () => {
    expect(email.subject).toBe("Confirm your email for School Organiser");
    expect(email.text).toMatchInlineSnapshot(`
      "Confirm your email

      We received a school email you forwarded to School Organiser.

      To start getting a short summary every Sunday evening, confirm your address:
      https://school.example.com/verify?token=abc

      This link works until Mon 13 Oct. If you don't confirm, we'll delete what you sent by then.

      If this wasn't you, ignore this email.

      --
      School Organiser · Forward school emails to hello@school.example.com
      Privacy: https://school.example.com/privacy"
    `);
  });

  it("has an HTML part with the same link, escaped", () => {
    expect(email.html).toContain('href="https://school.example.com/verify?token=abc"');
    expect(email.html).toContain("This link works until Mon 13 Oct.");
    expect(email.html).toContain('href="https://school.example.com/privacy"');
  });

  it("escapes anything unexpected in the link", () => {
    const risky = verificationEmail({
      link: 'https://school.example.com/verify?token="><script>',
      expires: new Date("2025-10-13T08:00:00.000Z"),
      appOrigin: "https://school.example.com",
    });
    expect(risky.html).not.toContain("<script>");
  });
});
