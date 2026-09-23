import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addressStub } from "../../src/bindings";
import { handleRequest } from "../../src/web/routes";
import { testDeps, type TestDeps } from "../helpers/deps";
import { sentTo } from "../helpers/stubs";

const ORIGIN = "http://localhost:8787";

function form(
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { Origin: ORIGIN, ...headers },
  });
}

async function verified(address: string): Promise<void> {
  await addressStub(env, address).link(`household-${address}`, "2025-10-01T08:00:00.000Z");
}

async function latestSignInLink(address: string): Promise<string> {
  const text = (await sentTo(address)).at(-1)?.text ?? "";
  const link = /https?:\/\/\S+\/sign-in\/confirm\?token=\S+/.exec(text)?.[0];
  if (link === undefined) throw new Error(`No sign-in link sent to ${address}`);
  return link;
}

/** Signs in through the emailed link and returns the session cookie. */
async function signedIn(address: string, deps: TestDeps): Promise<string> {
  await handleRequest(form("/sign-in", { email: address }), env, deps);
  const token = new URL(await latestSignInLink(address)).searchParams.get("token") ?? "";
  const response = await handleRequest(form("/sign-in/confirm", { token }), env, deps);
  const cookie = response.headers.get("Set-Cookie") ?? "";
  return cookie.split(";")[0] ?? "";
}

const text = async (response: Response): Promise<string> =>
  (await response.text()).replace(/\s+/g, " ");

describe("sign in", () => {
  it("emails a link to a verified address", async () => {
    const address = "signin-verified@example.com";
    await verified(address);
    const response = await handleRequest(
      form("/sign-in", { email: " Signin-Verified@Example.com " }),
      env,
      testDeps("signin verified"),
    );
    expect(await text(response)).toContain(
      "If <strong>signin-verified@example.com</strong> is signed up, we've sent it a link",
    );
    const sent = await sentTo(address);
    expect(sent.map((m) => m.subject)).toEqual(["Sign in to School Organiser"]);
  });

  it("gives the same answer for an unknown address and sends nothing", async () => {
    const address = "signin-unknown@example.com";
    const response = await handleRequest(
      form("/sign-in", { email: address }),
      env,
      testDeps("signin unknown"),
    );
    expect(response.status).toBe(200);
    expect(await text(response)).toContain(
      "If <strong>signin-unknown@example.com</strong> is signed up",
    );
    expect(await sentTo(address)).toEqual([]);
  });

  it("sends at most one link every two minutes", async () => {
    const address = "signin-limit@example.com";
    await verified(address);
    const deps = testDeps("signin limit");
    await handleRequest(form("/sign-in", { email: address }), env, deps);
    deps.clock.advance(2 * 60 * 1000 - 1);
    await handleRequest(form("/sign-in", { email: address }), env, deps);
    expect(await sentTo(address)).toHaveLength(1);
    deps.clock.advance(1);
    await handleRequest(form("/sign-in", { email: address }), env, deps);
    expect(await sentTo(address)).toHaveLength(2);
  });

  it("asks again for something that isn't an email address", async () => {
    const response = await handleRequest(
      form("/sign-in", { email: "not an email" }),
      env,
      testDeps("signin invalid"),
    );
    expect(response.status).toBe(400);
    expect(await text(response)).toContain("Enter an email address");
  });

  it("refuses a sign-in form posted from another site", async () => {
    const response = await handleRequest(
      form("/sign-in", { email: "x@example.com" }, { Origin: "https://evil.example" }),
      env,
      testDeps("signin cross site"),
    );
    expect(response.status).toBe(405);
  });
});

describe("the emailed link", () => {
  it("shows a button on GET without signing in", async () => {
    const address = "signin-get@example.com";
    await verified(address);
    const deps = testDeps("signin get");
    await handleRequest(form("/sign-in", { email: address }), env, deps);
    const response = await handleRequest(new Request(await latestSignInLink(address)), env, deps);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await text(response)).toContain('<form method="post" action="/sign-in/confirm">');
  });

  it("signs in on POST with a secure, HttpOnly cookie and goes to the household page", async () => {
    const address = "signin-post@example.com";
    await verified(address);
    const deps = testDeps("signin post");
    await handleRequest(form("/sign-in", { email: address }), env, deps);
    const token = new URL(await latestSignInLink(address)).searchParams.get("token") ?? "";
    const response = await handleRequest(form("/sign-in/confirm", { token }), env, deps);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/household");
    expect(response.headers.get("Set-Cookie")).toMatch(
      /^session=v1\..+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/,
    );
  });

  it("expires after 30 minutes", async () => {
    const address = "signin-expired@example.com";
    await verified(address);
    const deps = testDeps("signin expired");
    await handleRequest(form("/sign-in", { email: address }), env, deps);
    const token = new URL(await latestSignInLink(address)).searchParams.get("token") ?? "";
    deps.clock.advance(30 * 60 * 1000);
    const response = await handleRequest(form("/sign-in/confirm", { token }), env, deps);
    expect(response.status).toBe(400);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("/household", () => {
  it("needs a session", async () => {
    const response = await handleRequest(
      new Request(`${ORIGIN}/household`),
      env,
      testDeps("household anon"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/sign-in");
  });

  it("shows the signed-in address", async () => {
    const address = "household-page@example.com";
    await verified(address);
    const deps = testDeps("household page");
    const cookie = await signedIn(address, deps);
    const response = await handleRequest(
      new Request(`${ORIGIN}/household`, { headers: { Cookie: cookie } }),
      env,
      deps,
    );
    expect(response.status).toBe(200);
    expect(await text(response)).toContain(
      "Signed in as <strong>household-page@example.com</strong>",
    );
  });

  it("refuses a session cookie that has expired or been tampered with", async () => {
    const address = "household-expired@example.com";
    await verified(address);
    const deps = testDeps("household expired");
    const cookie = await signedIn(address, deps);
    const tampered = `${cookie.slice(0, -2)}xx`;
    const tamperedResponse = await handleRequest(
      new Request(`${ORIGIN}/household`, { headers: { Cookie: tampered } }),
      env,
      deps,
    );
    expect(tamperedResponse.status).toBe(303);
    deps.clock.advance(30 * 24 * 60 * 60 * 1000);
    const expired = await handleRequest(
      new Request(`${ORIGIN}/household`, { headers: { Cookie: cookie } }),
      env,
      deps,
    );
    expect(expired.status).toBe(303);
  });

  it("signs out by clearing the cookie", async () => {
    const response = await handleRequest(form("/sign-out", {}), env, testDeps("sign out"));
    expect(response.status).toBe(303);
    expect(response.headers.get("Set-Cookie")).toContain("session=; ");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
