import puppeteer from "@cloudflare/puppeteer";

/** Most PDF pages drawn per message (each becomes an image in the extraction request). */
export const MAX_RENDERED_PAGES = 10;
/** pdf.js scale: 1.5 draws an A4 page about 890 px wide, which the model reads reliably. */
const SCALE = 1.5;
/** Give up on a render after this long and fall back to the PDF's text. */
const TIMEOUT_MS = 60_000;

/** Draws PDF pages as images. Returns JPEG data URLs, or null if it couldn't. */
export interface PdfRenderer {
  render(pdf: Uint8Array, maxPages: number): Promise<string[] | null>;
}

/**
 * Browser Run in production. Tests (test/wrangler.test.jsonc) bind RENDERER to a stub instead,
 * because a real browser can't run offline or deterministically.
 */
export function pdfRenderer(env: Env): PdfRenderer {
  const stub = (env as unknown as { RENDERER?: PdfRenderer }).RENDERER;
  if (stub !== undefined) return stub;
  return {
    render: (pdf, maxPages) => renderWithBrowser(env, pdf, maxPages),
  };
}

async function renderWithBrowser(
  env: Env,
  pdf: Uint8Array,
  maxPages: number,
): Promise<string[] | null> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    // Our own page, which loads our self-hosted pdf.js (public/render-pdf.html).
    await page.goto(`${env.APP_ORIGIN}/render-pdf`, { waitUntil: "load" });
    await page.waitForFunction("window.renderPdfReady === true");
    // A string expression, not a function: puppeteer would send the function's source, which
    // bundling can change.
    const pages = (await page.evaluate(
      `window.renderPdf(${JSON.stringify(toBase64(pdf))}, ${String(maxPages)}, ${String(SCALE)})`,
    )) as string[];
    return pages.length > 0 ? pages : null;
  } catch (error) {
    console.error("pdf render failed", {
      error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
    });
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
