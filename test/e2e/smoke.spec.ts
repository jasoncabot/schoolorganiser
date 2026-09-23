import { expect, test } from "@playwright/test";

test("home page explains how to start", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("School Organiser");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Every school email, in one short weekly summary",
  );
  await expect(page.getByText("hello@school.jasoncabot.com")).toBeVisible();
});

test("home page is styled", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header).toHaveCSS("background-color", "rgb(11, 12, 12)");
});

test("skip link is the first thing keyboard users reach", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
});

test("inbound email reaches the Worker", async ({ request }) => {
  const raw = [
    "From: Parent <parent-e2e@example.com>",
    "To: hello@school.example.com",
    "Subject: Fwd: Harvest festival",
    "Message-ID: <smoke-1@example.com>",
    "Date: Mon, 6 Oct 2025 09:00:00 +0100",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Forwarded letter body.",
  ].join("\r\n");
  const response = await request.post(
    "/cdn-cgi/local/email?from=parent-e2e@example.com&to=hello@school.example.com",
    { data: raw, headers: { "Content-Type": "message/rfc822" } },
  );
  expect(response.ok()).toBe(true);
});

test("headings use the self-hosted Inter Tight font", async ({ page }) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveCSS("font-family", /^"Inter Tight"/);
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('700 48px "Inter Tight"');
  });
  expect(loaded).toBe(true);
});
