import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addressStub, householdStub } from "../../src/bindings";
import { handleInbound } from "../../src/email/inbound";
import { handleRequest } from "../../src/web/routes";
import { testDeps, type TestDeps } from "../helpers/deps";
import { CLOUDFLARE_PASS, fakeMessage } from "../helpers/email";
import { sentTo } from "../helpers/stubs";

const ORIGIN = "http://localhost:8787";
// Mid-way through the 2026/27 school year.
const NOW = "2026-10-05T09:00:00.000Z";

function post(path: string, fields: Record<string, string>, cookie: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { Origin: ORIGIN, Cookie: cookie },
  });
}
const get = (path: string, cookie: string): Request =>
  new Request(`${ORIGIN}${path}`, { headers: { Cookie: cookie } });
const text = async (response: Response): Promise<string> =>
  (await response.text()).replace(/\s+/g, " ");

/** A verified household with one member, signed in. */
async function signedIn(
  name: string,
  now = NOW,
): Promise<{ deps: TestDeps; cookie: string; address: string; householdId: string }> {
  const deps = testDeps(name, now);
  const address = `${name.replaceAll(" ", "-")}@example.com`;
  const householdId = `household-${name.replaceAll(" ", "-")}`;
  await (await householdStub(env, householdId)).addMember(address, NOW);
  await addressStub(env, address).link(householdId, NOW);
  await handleRequest(
    new Request(`${ORIGIN}/sign-in`, {
      method: "POST",
      body: new URLSearchParams({ email: address }),
      headers: { Origin: ORIGIN },
    }),
    env,
    deps,
  );
  const link =
    /\/sign-in\/confirm\?token=\S+/.exec((await sentTo(address)).at(-1)?.text ?? "")?.[0] ?? "";
  const token = new URL(link, ORIGIN).searchParams.get("token") ?? "";
  const response = await handleRequest(
    new Request(`${ORIGIN}/sign-in/confirm`, {
      method: "POST",
      body: new URLSearchParams({ token }),
      headers: { Origin: ORIGIN },
    }),
    env,
    deps,
  );
  return {
    deps,
    cookie: (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "",
    address,
    householdId,
  };
}

describe("children", () => {
  it("adds a child and shows them on the household page", async () => {
    const { deps, cookie, householdId } = await signedIn("children add");
    const added = await handleRequest(
      post(
        "/household/children",
        { name: "Ada", school: "Oakfield Primary", yearGroup: "3", className: "Oak" },
        cookie,
      ),
      env,
      deps,
    );
    expect(added.status).toBe(303);

    const household = await householdStub(env, householdId);
    expect(await household.children()).toEqual([
      {
        id: expect.any(String) as string,
        name: "Ada",
        school: "Oakfield Primary",
        yearGroup: 3,
        yearGroupAsOf: 2026,
        className: "Oak",
      },
    ]);
    expect(await household.childrenVersion()).toBe(1);
    const page = await text(await handleRequest(get("/household", cookie), env, deps));
    expect(page).toContain("<dt>Ada</dt>");
    expect(page).toContain("Oakfield Primary<br />Year 3, Oak");
  });

  it("explains what's wrong with an incomplete form", async () => {
    const { deps, cookie, householdId } = await signedIn("children invalid");
    const response = await handleRequest(
      post("/household/children", { name: "", school: "Oakfield", yearGroup: "" }, cookie),
      env,
      deps,
    );
    expect(response.status).toBe(400);
    const body = await text(response);
    expect(body).toContain("Enter a name");
    expect(body).toContain("Choose a year group");
    expect(await (await householdStub(env, householdId)).children()).toEqual([]);
  });

  it("changes and removes a child, counting each change", async () => {
    const { deps, cookie, householdId } = await signedIn("children change");
    await handleRequest(
      post(
        "/household/children",
        { name: "Sam", school: "Riverside Juniors", yearGroup: "1" },
        cookie,
      ),
      env,
      deps,
    );
    const household = await householdStub(env, householdId);
    const [sam] = await household.children();
    if (sam === undefined) throw new Error("no child");

    const form = await text(
      await handleRequest(get(`/household/children/${sam.id}`, cookie), env, deps),
    );
    expect(form).toContain('<option value="1" selected>Year 1</option>');
    await handleRequest(
      post(
        `/household/children/${sam.id}`,
        { name: "Sam", school: "Riverside Juniors", yearGroup: "2" },
        cookie,
      ),
      env,
      deps,
    );
    expect((await household.children())[0]?.yearGroup).toBe(2);

    await handleRequest(post(`/household/children/${sam.id}/remove`, {}, cookie), env, deps);
    expect(await household.children()).toEqual([]);
    expect(await household.childrenVersion()).toBe(3);
  });

  it("shows this year's year group after September", async () => {
    // Added in August, the last month of the 2026/27 school year.
    const { deps, cookie } = await signedIn("children next year", "2027-08-20T09:00:00.000Z");
    await handleRequest(
      post(
        "/household/children",
        { name: "Ada", school: "Oakfield Primary", yearGroup: "3" },
        cookie,
      ),
      env,
      deps,
    );
    deps.clock.set("2027-09-06T09:00:00.000Z");
    const page = await text(await handleRequest(get("/household", cookie), env, deps));
    expect(page).toContain("Year 4");
  });

  it("can't touch another household's children", async () => {
    const owner = await signedIn("children owner");
    await handleRequest(
      post(
        "/household/children",
        { name: "Ada", school: "Oakfield Primary", yearGroup: "3" },
        owner.cookie,
      ),
      env,
      owner.deps,
    );
    const [ada] = await (await householdStub(env, owner.householdId)).children();
    const other = await signedIn("children other");
    const response = await handleRequest(
      post(`/household/children/${ada?.id ?? ""}/remove`, {}, other.cookie),
      env,
      other.deps,
    );
    expect(response.status).toBe(404);
    expect(await (await householdStub(env, owner.householdId)).children()).toHaveLength(1);
  });

  it("refuses changes posted from another site", async () => {
    const { deps, cookie } = await signedIn("children cross site");
    const request = new Request(`${ORIGIN}/household/children`, {
      method: "POST",
      body: new URLSearchParams({ name: "Eve", school: "X", yearGroup: "1" }),
      headers: { Origin: "https://evil.example", Cookie: cookie },
    });
    expect((await handleRequest(request, env, deps)).status).toBe(405);
  });
});

describe("invitations", () => {
  it("emails a join link, and joining adds the member, signs them in and moves their held mail", async () => {
    const { deps, cookie, householdId, address } = await signedIn("invite join");
    const partner = "invite-partner@example.com";
    // The partner already forwarded a letter, which is being held.
    await handleInbound(
      fakeMessage({
        to: "hello@school.example.com",
        headers: [CLOUDFLARE_PASS, ["From", partner]],
        body: "Held letter",
      }),
      env,
      deps,
    );

    const invited = await text(
      await handleRequest(post("/household/members", { email: partner }, cookie), env, deps),
    );
    expect(invited).toContain(`We've emailed ${partner} a link to join.`);
    const email = (await sentTo(partner)).at(-1);
    expect(email?.subject).toBe("You're invited to School Organiser");
    expect(email?.text).toContain(`${address} has invited you`);

    const token =
      new URL(/\/join\?token=\S+/.exec(email?.text ?? "")?.[0] ?? "", ORIGIN).searchParams.get(
        "token",
      ) ?? "";
    const preview = await text(
      await handleRequest(
        new Request(`${ORIGIN}/join?token=${encodeURIComponent(token)}`),
        env,
        deps,
      ),
    );
    expect(preview).toContain('<form method="post" action="/join">');

    const joined = await handleRequest(
      new Request(`${ORIGIN}/join`, {
        method: "POST",
        body: new URLSearchParams({ token }),
        headers: { Origin: ORIGIN },
      }),
      env,
      deps,
    );
    expect(joined.status).toBe(303);
    expect(joined.headers.get("Set-Cookie")).toMatch(/^session=/);

    const household = await householdStub(env, householdId);
    expect((await household.members()).map((m) => m.address).sort()).toEqual(
      [address, partner].sort(),
    );
    expect(await addressStub(env, partner).lookup()).toMatchObject({
      status: "verified",
      householdId,
      pending: [],
    });
    expect(await household.messages()).toHaveLength(1);
  });

  it("won't invite someone who's already in another household", async () => {
    const { deps, cookie } = await signedIn("invite taken");
    const other = await signedIn("invite taken other");
    const response = await text(
      await handleRequest(post("/household/members", { email: other.address }, cookie), env, deps),
    );
    expect(response).toContain("already gets a summary for another household");
    expect((await sentTo(other.address)).filter((m) => m.subject.includes("invited"))).toEqual([]);
  });

  it("refuses an expired invitation", async () => {
    const { deps, cookie } = await signedIn("invite expired");
    const partner = "invite-expired-partner@example.com";
    await handleRequest(post("/household/members", { email: partner }, cookie), env, deps);
    const token =
      new URL(
        /\/join\?token=\S+/.exec((await sentTo(partner)).at(-1)?.text ?? "")?.[0] ?? "",
        ORIGIN,
      ).searchParams.get("token") ?? "";
    deps.clock.advance(7 * 24 * 60 * 60 * 1000);
    const response = await handleRequest(
      new Request(`${ORIGIN}/join`, {
        method: "POST",
        body: new URLSearchParams({ token }),
        headers: { Origin: ORIGIN },
      }),
      env,
      deps,
    );
    expect(response.status).toBe(400);
    expect((await addressStub(env, partner).lookup()).status).toBe("unknown");
  });
});
