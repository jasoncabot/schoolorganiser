import { addressStub } from "../bindings";
import type { Deps } from "../deps";
import { signInEmail } from "../email/outbound";
import { signToken, verifyToken } from "../tokens";
import { html, page } from "./html";
import { clearSessionCookie, readSession, sameOrigin, sessionCookie } from "./session";

const LINK_MINUTES = 30;

interface SignInPayload {
  purpose: "sign-in";
  address: string;
  expires: string;
}

/** GET shows the form; POST emails a link if the address belongs to a household. */
export async function signIn(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (request.method === "GET") {
    if ((await readSession(request, env, deps)) !== null) return redirect("/household");
    return signInForm();
  }
  if (request.method !== "POST" || !sameOrigin(request, env)) return notAllowed();
  const submitted = (await request.formData()).get("email");
  const address = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
    return signInForm("Enter an email address, like name@example.com", 400);

  const now = deps.clock.now();
  if (await addressStub(env, address).claimSignInSend(now.toISOString())) {
    const expires = new Date(now.getTime() + LINK_MINUTES * 60 * 1000);
    const payload: SignInPayload = { purpose: "sign-in", address, expires: expires.toISOString() };
    const link = `${env.APP_ORIGIN}/sign-in/confirm?token=${encodeURIComponent(await signToken(payload, env.SIGNING_KEY))}`;
    const email = signInEmail({ link, appOrigin: env.APP_ORIGIN });
    await env.EMAIL.send({
      to: address,
      from: { email: env.SENDER_ADDRESS, name: "School Organiser" },
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
  // The same answer whether or not we sent anything, so this can't reveal who has an account.
  return page(
    "Check your email",
    html`<h1>Check your email</h1>
      <p>
        If <strong>${address}</strong> is signed up, we've sent it a link to sign in. The link works
        for ${String(LINK_MINUTES)} minutes.
      </p>
      <p>
        Not signed up yet? Forward a school email to
        <strong>hello@${new URL(env.APP_ORIGIN).hostname}</strong> to start.
      </p>`,
  );
}

/** GET shows a button (mail scanners follow links); POST signs in and sets the session cookie. */
export async function confirmSignIn(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return notAllowed();
  if (request.method === "POST" && !sameOrigin(request, env)) return notAllowed();
  const submitted = request.method === "POST" ? (await request.formData()).get("token") : null;
  const token =
    request.method === "POST"
      ? typeof submitted === "string"
        ? submitted
        : ""
      : (new URL(request.url).searchParams.get("token") ?? "");
  const payload = await verifyToken<SignInPayload>(
    token,
    "sign-in",
    env.SIGNING_KEY,
    deps.clock.now(),
  );
  if (payload === null) {
    return page(
      "Link not valid",
      html`<h1>This link has expired or isn't valid</h1>
        <p><a href="/sign-in">Ask for a new sign-in link</a>.</p>`,
      400,
    );
  }
  if (request.method === "GET") {
    return page(
      "Sign in",
      html`<h1>Sign in</h1>
        <p>Sign in as <strong>${payload.address}</strong>.</p>
        <form method="post" action="/sign-in/confirm">
          <input type="hidden" name="token" value="${token}" />
          <button type="submit" class="button">Sign in</button>
        </form>`,
    );
  }
  const state = await addressStub(env, payload.address).lookup();
  if (state.status !== "verified") return redirect("/sign-in");
  return redirect("/household", await sessionCookie(env, deps, payload.address));
}

export function signOut(request: Request, env: Env): Response {
  if (request.method !== "POST" || !sameOrigin(request, env)) return notAllowed();
  return redirect("/", clearSessionCookie);
}

function signInForm(error?: string, status = 200): Response {
  const problem =
    error === undefined
      ? html``
      : html`<div class="error-summary" role="alert"><p>${error}</p></div>`;
  return page(
    "Sign in",
    html`<h1>Sign in</h1>
      ${problem}
      <form method="post" action="/sign-in" novalidate>
        <label class="label" for="email">Email address</label>
        <p class="hint">The address you forward school emails from.</p>
        <input
          class="input"
          id="email"
          name="email"
          type="email"
          autocomplete="email"
          spellcheck="false"
          required
        />
        <button type="submit" class="button">Send me a link</button>
      </form>`,
    status,
  );
}

export function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (setCookie !== undefined) headers.set("Set-Cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

export function notAllowed(): Response {
  return new Response("Not allowed", { status: 405 });
}
