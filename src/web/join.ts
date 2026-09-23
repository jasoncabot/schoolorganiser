import { addressStub } from "../bindings";
import type { Deps } from "../deps";
import { verifyToken } from "../tokens";
import { joinHousehold } from "../verification";
import type { InvitePayload } from "./household";
import { html, page } from "./html";
import { sameOrigin, sessionCookie } from "./session";
import { notAllowed, redirect } from "./sign-in";

/** GET shows the invitation (mail scanners follow links); POST joins and signs in. */
export async function join(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return notAllowed();
  if (request.method === "POST" && !sameOrigin(request, env)) return notAllowed();
  const submitted = request.method === "POST" ? (await request.formData()).get("token") : null;
  const token =
    request.method === "POST"
      ? typeof submitted === "string"
        ? submitted
        : ""
      : (new URL(request.url).searchParams.get("token") ?? "");
  const invite = await verifyToken<InvitePayload>(
    token,
    "invite",
    env.SIGNING_KEY,
    deps.clock.now(),
  );
  if (invite === null) {
    return page(
      "Link not valid",
      html`<h1>This invitation has expired or isn't valid</h1>
        <p>Ask the person who invited you to send a new one.</p>`,
      400,
    );
  }
  const state = await addressStub(env, invite.address).lookup();
  if (state.status === "verified" && state.householdId !== invite.householdId) {
    return page(
      "Already signed up",
      html`<h1>You already get a summary for another household</h1>
        <p>${invite.address} is already part of a household, so it can't join this one.</p>`,
      409,
    );
  }
  if (request.method === "GET") {
    return page(
      "Join a household",
      html`<h1>Join a household</h1>
        <p>
          <strong>${invite.invitedBy}</strong> has invited <strong>${invite.address}</strong> to get
          their household's weekly school summary.
        </p>
        <p>
          You'll get a short email every Sunday evening. Read the
          <a href="/privacy">privacy notice</a> to see what we keep and why.
        </p>
        <form method="post" action="/join">
          <input type="hidden" name="token" value="${token}" />
          <button type="submit" class="button">Join</button>
        </form>`,
    );
  }
  await joinHousehold(env, deps, invite.address, invite.householdId);
  return redirect("/household", await sessionCookie(env, deps, invite.address));
}
