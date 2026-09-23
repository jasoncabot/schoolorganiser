import { householdStub } from "../bindings";
import type { Deps } from "../deps";
import { addDays } from "../retention";
import { signToken, verifyToken, type TokenPayload } from "../tokens";
import { html, page } from "./html";

interface StopPayload extends TokenPayload {
  purpose: "stop-digest";
  address: string;
  householdId: string;
}

/** How long a digest's stop link works. Longer than we keep anything the digest refers to. */
const STOP_LINK_DAYS = 365;

/** The link in a digest that stops digests to `address`. */
export async function stopLink(
  env: Env,
  address: string,
  householdId: string,
  now: Date,
): Promise<string> {
  const payload: StopPayload = {
    purpose: "stop-digest",
    address,
    householdId,
    expires: addDays(now, STOP_LINK_DAYS).toISOString(),
  };
  const token = await signToken(payload, env.SIGNING_KEY);
  return `${env.APP_ORIGIN}/stop?token=${encodeURIComponent(token)}`;
}

/**
 * GET shows a button, because mail scanners follow links. POST stops: from that button, or from
 * a mail app's one-click unsubscribe (RFC 8058), which posts to the link itself with no Origin
 * or cookies. The token is the only authority, so there's no Origin check.
 */
export async function stop(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }
  const url = new URL(request.url);
  let token = url.searchParams.get("token") ?? "";
  if (request.method === "POST" && isForm(request)) {
    const submitted = (await request.formData()).get("token");
    if (typeof submitted === "string") token = submitted;
  }
  const payload = await verifyToken<StopPayload>(
    token,
    "stop-digest",
    env.SIGNING_KEY,
    deps.clock.now(),
  );
  if (payload === null) {
    return page(
      "Link not valid",
      html`<h1>This link isn't valid</h1>
        <p>Use the stop link in your most recent weekly email.</p>`,
      400,
    );
  }
  if (request.method === "GET") {
    return page(
      "Stop weekly emails",
      html`<h1>Stop weekly emails</h1>
        <p>Stop sending the weekly school summary to <strong>${payload.address}</strong>.</p>
        <form method="post" action="/stop">
          <input type="hidden" name="token" value="${token}" />
          <button type="submit" class="button">Stop weekly emails</button>
        </form>`,
    );
  }
  const household = await householdStub(env, payload.householdId);
  await household.stopDigest(payload.address, deps.clock.now().toISOString());
  return page(
    "Weekly emails stopped",
    html`<h1>Weekly emails stopped</h1>
      <p>
        We won't send the weekly summary to <strong>${payload.address}</strong>. We've kept your
        household's details and emails.
      </p>
      <p><a href="/household">Sign in</a> to start it again.</p>`,
  );
}

function isForm(request: Request): boolean {
  const type = request.headers.get("Content-Type") ?? "";
  return (
    type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data")
  );
}
