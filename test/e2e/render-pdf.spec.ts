import { expect, test } from "@playwright/test";
import { pdf } from "../helpers/mime";

// Browser Run opens this page in production (src/extract/render.ts). This runs the same page
// in Chromium, so a pdf.js upgrade that breaks rendering fails here first.
test("the render page draws a PDF's pages as JPEG images", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${String(r.status())} ${r.url()}`);
  });

  await page.goto("/render-pdf");
  await page.waitForFunction("window.renderPdfReady === true");
  const bytes = pdf([
    { text: "SEPTEMBER", x: 50, y: 520 },
    { text: "30th - Year 3 - Chester Zoo trip", x: 50, y: 500 },
  ]);
  const base64 = Buffer.from(bytes).toString("base64");
  const result: unknown = await page.evaluate(
    `window.renderPdf(${JSON.stringify(base64)}, 10, 1.5)`,
  );
  const pages = Array.isArray(result) ? result.map(String) : [];

  expect(pages).toHaveLength(1);
  expect(pages[0]).toMatch(/^data:image\/jpeg;base64,/);
  expect(pages[0]?.length ?? 0).toBeGreaterThan(5000);
  expect(errors).toEqual([]);
});
