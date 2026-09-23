import { expect, test } from "@playwright/test";

// Local email arrives without Cloudflare's authentication results, so the test adds the header
// Email Routing would. The Worker trusts it only because it's the topmost one from mx.cloudflare.net.
function forwardedEmail(from: string, subject: string): string {
  return [
    "ARC-Authentication-Results: i=1; mx.cloudflare.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=" +
      from,
    `From: Parent <${from}>`,
    "To: hello@school.example.com",
    `Subject: ${subject}`,
    `Message-ID: <${subject.replace(/\W/g, "")}@example.com>`,
    "Date: Mon, 6 Oct 2025 09:00:00 +0100",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Harvest festival is on Friday 10 October at 2pm.",
  ].join("\r\n");
}

test("a parent forwards a school email, confirms, and their email is kept", async ({
  page,
  request,
}) => {
  // Each Playwright run starts wrangler dev with empty state (playwright.config.ts).
  const parent = "e2e-verify@example.com";

  const delivered = await request.post(
    `/cdn-cgi/local/email?from=${encodeURIComponent(parent)}&to=hello@school.example.com`,
    {
      data: forwardedEmail(parent, "Fwd: Harvest festival"),
      headers: { "Content-Type": "message/rfc822" },
    },
  );
  expect(delivered.ok()).toBe(true);

  const outbox = await request.get(`/__test/outbox?to=${encodeURIComponent(parent)}`);
  const sent = (await outbox.json()) as { subject: string; text: string }[];
  expect(sent.map((m) => m.subject)).toEqual(["Confirm your email for School Organiser"]);
  const link = /\/verify\?token=\S+/.exec(sent[0]?.text ?? "")?.[0];
  expect(link).toBeDefined();

  await page.goto(link ?? "");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirm your email");
  await expect(page.getByText(parent)).toBeVisible();
  await expect(page.getByRole("link", { name: "privacy notice" })).toHaveAttribute(
    "href",
    "/privacy",
  );

  await page.getByRole("button", { name: "Confirm my email" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're all set");
  await expect(page.getByText("We've added the email you already sent.")).toBeVisible();
});

test("an invalid link explains what to do", async ({ page }) => {
  const response = await page.goto("/verify?token=v1.bad.link");
  expect(response?.status()).toBe(400);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This link has expired or isn't valid",
  );
});

test("the privacy notice is published", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy notice");
  await expect(page.getByRole("table")).toBeVisible();
});
