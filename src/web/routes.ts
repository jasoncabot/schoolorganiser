import type { Deps } from "../deps";
import { confirmVerification, readVerificationToken } from "../verification";
import { html, page } from "./html";

/** Worker-rendered pages. Static pages and assets are served by Workers static assets first. */
export async function handleRequest(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/verify") return verify(request, url, env, deps);
  if (url.pathname === "/__test/outbox") return testOutbox(url, env);
  return env.ASSETS.fetch(request);
}

/**
 * Test-only: what the email stub has "sent" to an address, for Playwright. Exists only when
 * E2E_TEST_ROUTES is set, which only test/wrangler.test.jsonc does. Production has no such var.
 */
async function testOutbox(url: URL, env: Env): Promise<Response> {
  const flags = env as unknown as { E2E_TEST_ROUTES?: string };
  const to = url.searchParams.get("to");
  if (flags.E2E_TEST_ROUTES !== "1" || to === null)
    return new Response("Not found", { status: 404 });
  const stub = env.EMAIL as unknown as { sentTo(address: string): Promise<unknown> };
  return Response.json(await stub.sentTo(to));
}

/**
 * GET shows a confirm button; only POST verifies. Mail scanners follow links in emails, so a
 * GET must never change anything.
 */
async function verify(request: Request, url: URL, env: Env, deps: Deps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }
  const submitted = request.method === "POST" ? (await request.formData()).get("token") : null;
  const token =
    request.method === "POST"
      ? typeof submitted === "string"
        ? submitted
        : ""
      : (url.searchParams.get("token") ?? "");
  const address = token === "" ? null : await readVerificationToken(env, deps, token);
  if (address === null) return invalidLink();

  if (request.method === "GET") {
    return page(
      "Confirm your email",
      html`<h1>Confirm your email</h1>
        <p>
          Confirm you'd like a short summary of your school emails every Sunday evening, sent to
          <strong>${address}</strong>.
        </p>
        <p>
          We'll read the school emails you forward and keep them for 90 days. Read the
          <a href="/privacy">privacy notice</a> to see exactly what we keep and why.
        </p>
        <form method="post" action="/verify">
          <input type="hidden" name="token" value="${token}" />
          <button type="submit" class="button">Confirm my email</button>
        </form>`,
    );
  }

  const result = await confirmVerification(env, deps, address);
  const saved =
    result.moved === 0
      ? html``
      : html`<p>
          We've added the ${result.moved === 1 ? "email" : `${String(result.moved)} emails`} you
          already sent.
        </p>`;
  return page(
    "You're all set",
    html`<h1>You're all set</h1>
      ${saved}
      <p>
        Keep forwarding school emails to <strong>hello@${new URL(env.APP_ORIGIN).hostname}</strong>.
        Your first summary arrives on Sunday evening.
      </p>`,
  );
}

function invalidLink(): Response {
  return page(
    "Link not valid",
    html`<h1>This link has expired or isn't valid</h1>
      <p>Forward another school email to get a new link.</p>`,
    400,
  );
}
