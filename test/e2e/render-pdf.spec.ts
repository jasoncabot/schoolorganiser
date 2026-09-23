import { expect, test } from "@playwright/test";
import { pdf } from "../helpers/mime";

// Browser Run's screenshot Quick Action opens this page in production (src/extract/render.ts).
// This runs the same page in Chromium, so a pdf.js upgrade that breaks rendering fails here first.
test("the render page draws the requested PDF page on a canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${String(r.status())} ${r.url()}`);
  });
  const bytes = pdf([
    { text: "SEPTEMBER", x: 50, y: 520 },
    { text: "30th - Year 3 - Chester Zoo trip", x: 50, y: 500 },
  ]);
  // Stands in for /render-source, which needs a token and a copy in R2.
  await page.route("**/e2e-letter.pdf", (route) =>
    route.fulfill({ status: 200, contentType: "application/pdf", body: Buffer.from(bytes) }),
  );

  await page.goto(`/render-pdf?page=1&src=${encodeURIComponent("/e2e-letter.pdf")}`);
  await expect(page.locator("#rendered")).toBeAttached();
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(1000);
  expect((await canvas.screenshot({ type: "jpeg" })).length).toBeGreaterThan(5000);
  expect(errors).toEqual([]);
});

test("the render page refuses a PDF from another site", async ({ page }) => {
  await page.goto(`/render-pdf?page=1&src=${encodeURIComponent("https://example.com/x.pdf")}`);
  await expect(page.locator("#failed")).toBeAttached();
  await expect(page.locator("canvas")).toHaveCount(0);
});
