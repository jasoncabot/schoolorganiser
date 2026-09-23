import { getDocumentProxy } from "unpdf";
import type { Deps } from "../deps";
import { signToken, verifyToken } from "../tokens";

/** Most PDF pages drawn per message (each becomes an image in the extraction request). */
export const MAX_RENDERED_PAGES = 10;
/** How long Browser Run may fetch the temporary copy of a PDF. */
const SOURCE_MINUTES = 5;
/** Longest wait for a page to draw before giving up on it. */
const PAGE_TIMEOUT_MS = 30_000;

/** Draws PDF pages as images. Returns JPEG data URLs, or null if it couldn't. */
export interface PdfRenderer {
  render(pdf: Uint8Array, maxPages: number): Promise<string[] | null>;
}

interface SourcePayload {
  purpose: "render-source";
  key: string;
  expires: string;
}

/**
 * Browser Run in production, using the `screenshot` Quick Action as Cloudflare's Browser Run
 * guidance recommends for self-contained screenshots. Tests (test/wrangler.test.jsonc) bind
 * RENDERER to a stub instead, because a real browser can't run offline or deterministically.
 */
export function pdfRenderer(env: Env, deps: Deps): PdfRenderer {
  const stub = (env as unknown as { RENDERER?: PdfRenderer }).RENDERER;
  if (stub !== undefined) return stub;
  return { render: (pdf, maxPages) => renderWithQuickActions(env, deps, pdf, maxPages) };
}

/**
 * Browser Run can't open a PDF directly, so: keep a temporary copy in R2 (render/…), let our
 * /render-pdf page fetch it through a 5-minute signed link and draw one page with our pdf.js,
 * and screenshot that page's canvas with a Quick Action, one call per page in parallel.
 * The copy is deleted straight afterwards; an R2 lifecycle rule removes any left behind.
 */
async function renderWithQuickActions(
  env: Env,
  deps: Deps,
  pdf: Uint8Array,
  maxPages: number,
): Promise<string[] | null> {
  const key = `render/${deps.ids.next()}.pdf`;
  try {
    const pageCount = (await getDocumentProxy(pdf.slice())).numPages;
    if (pageCount < 1) return null;
    await env.MAIL.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
    const expires = new Date(deps.clock.now().getTime() + SOURCE_MINUTES * 60 * 1000);
    const payload: SourcePayload = {
      purpose: "render-source",
      key,
      expires: expires.toISOString(),
    };
    const src = `/render-source?token=${encodeURIComponent(await signToken(payload, env.SIGNING_KEY))}`;

    const pages = await Promise.all(
      Array.from({ length: Math.min(pageCount, maxPages) }, (_, i) =>
        screenshot(
          env,
          `${env.APP_ORIGIN}/render-pdf?page=${String(i + 1)}&src=${encodeURIComponent(src)}`,
        ),
      ),
    );
    return pages;
  } catch (error) {
    console.error("pdf render failed", {
      error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
    });
    return null;
  } finally {
    await env.MAIL.delete(key).catch(() => undefined);
  }
}

async function screenshot(env: Env, url: string): Promise<string> {
  const response = await env.BROWSER.quickAction("screenshot", {
    url,
    waitForSelector: { selector: "#rendered, #failed", timeout: PAGE_TIMEOUT_MS },
    selector: "canvas",
    screenshotOptions: { type: "jpeg", quality: 80 },
    viewport: { width: 1000, height: 1400 },
  });
  if (!response.ok) throw new Error(`screenshot ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:image/jpeg;base64,${toBase64(bytes)}`;
}

/**
 * GET /render-source?token=…: the temporary PDF copy, for our render page in Browser Run.
 * Only with a valid, unexpired token for that exact copy.
 */
export async function renderSource(request: Request, env: Env, deps: Deps): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const payload = await verifyToken<SourcePayload>(
    token,
    "render-source",
    env.SIGNING_KEY,
    deps.clock.now(),
  );
  if (!payload?.key.startsWith("render/")) return new Response("Not found", { status: 404 });
  const object = await env.MAIL.get(payload.key);
  if (object === null) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
