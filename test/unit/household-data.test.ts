import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addressStub, householdStub } from "../../src/bindings";
import { Household } from "../../src/household";
import { handleRequest } from "../../src/web/routes";
import { sessionCookie } from "../../src/web/session";
import { testDeps, type TestDeps } from "../helpers/deps";

const ORIGIN = "http://localhost:8787";
// Sunday 12 Oct 2025, 10:00 BST.
const NOW = "2025-10-12T09:00:00.000Z";

const text = async (response: Response): Promise<string> =>
  (await response.text()).replace(/\s+/g, " ");

/** A household with the given members, signed in as the first, holding one message in R2. */
async function household(name: string, members: string[]) {
  const deps = testDeps(name, NOW);
  const householdId = `household-${name}`;
  const stub = await householdStub(env, householdId);
  for (const address of members) {
    await stub.addMember(address, NOW);
    await addressStub(env, address).link(householdId, NOW);
  }
  const key = `mail/${householdId}/m1.eml`;
  await env.MAIL.put(key, "raw");
  await env.MAIL.put(`mail/${householdId}/orphan.eml`, "raw");
  await runInDurableObject(stub, (_instance: Household, state) => {
    const sql = state.storage.sql;
    sql.exec(
      `INSERT INTO messages (id, r2_key, received_at, expires_at, status, subject)
       VALUES ('m1', ?, '2025-10-08T08:00:00.000Z', '2026-01-06T08:00:00.000Z', 'done', 'Fwd: Trip')`,
      key,
    );
    const item = (id: string, date: string, title: string) =>
      sql.exec(
        `INSERT INTO items (id, message_id, date, kind, title, confidence, expires_at, child_ids, maybe_child_ids)
         VALUES (?, 'm1', ?, 'event', ?, 'high', '2026-01-11T00:00:00.000Z', NULL, '[]')`,
        id,
        date,
        title,
      );
    item("m1-0", "2025-10-10", "Already happened");
    item("m1-1", "2025-10-12", "Harvest festival");
    item("m1-2", "2025-12-05", "Christmas fair");
  });
  const cookie = (await sessionCookie(env, deps, members[0] ?? "")).split(";")[0] ?? "";
  return { deps, stub, cookie, householdId, key };
}

function request(path: string, cookie: string, fields?: Record<string, string>): Request {
  return fields === undefined
    ? new Request(`${ORIGIN}${path}`, { headers: { Cookie: cookie } })
    : new Request(`${ORIGIN}${path}`, {
        method: "POST",
        body: new URLSearchParams(fields),
        headers: { Cookie: cookie, Origin: ORIGIN },
      });
}

const go = (r: Request, deps: TestDeps) => handleRequest(r, env, deps);

describe("coming up", () => {
  it("lists relevant items from today on, by day", async () => {
    const { deps, cookie } = await household("upcoming", ["upcoming@example.com"]);
    const page = await text(await go(request("/household/upcoming", cookie), deps));
    expect(page).toContain('<h2>Sun 12 Oct</h2> <ul class="list"> <li>Harvest festival</li>');
    expect(page).toContain("<h2>Fri 5 Dec</h2>");
    expect(page).not.toContain("Already happened");
  });

  it("is linked from the household page", async () => {
    const { deps, cookie } = await household("upcoming-link", ["upcoming-link@example.com"]);
    expect(await text(await go(request("/household", cookie), deps))).toContain(
      '<a href="/household/upcoming">',
    );
  });
});

describe("weekly email", () => {
  it("stops and starts again for the signed-in member", async () => {
    const address = "toggle@example.com";
    const { deps, stub, cookie } = await household("toggle", [address]);
    const stop = await go(request("/household/digest", cookie, { digest: "stop" }), deps);
    expect(stop.status).toBe(303);
    expect((await stub.members())[0]?.digestStoppedAt).toBe(NOW);
    expect(await text(await go(request("/household", cookie), deps))).toContain(
      "Start my weekly email again",
    );

    await go(request("/household/digest", cookie, { digest: "start" }), deps);
    expect((await stub.members())[0]?.digestStoppedAt).toBeNull();
  });
});

describe("deleting data", () => {
  it("asks first, then deletes everything and forgets every member", async () => {
    const [me, other] = ["delete-me@example.com", "delete-other@example.com"];
    const { deps, stub, cookie, householdId, key } = await household("delete", [me, other]);

    const confirm = await text(await go(request("/household/delete", cookie), deps));
    expect(confirm).toContain("The other person in your household will stop getting");
    expect(await stub.members()).toHaveLength(2);

    const done = await go(request("/household/delete", cookie, {}), deps);
    expect(await text(done)).toContain("Your household's data is deleted");
    expect(done.headers.get("Set-Cookie")).toContain("Max-Age=0");

    expect(await env.MAIL.get(key)).toBeNull();
    expect((await env.MAIL.list({ prefix: `mail/${householdId}/` })).objects).toHaveLength(0);
    for (const address of [me, other]) {
      expect(await addressStub(env, address).lookup()).toEqual({ status: "unknown" });
    }
    const after = await householdStub(env, householdId);
    expect(await after.members()).toEqual([]);
    expect(await after.items()).toEqual([]);

    // The old session no longer works.
    const again = await go(request("/household", cookie), deps);
    expect(again.headers.get("Location")).toBe("/sign-in");
  });
});

describe("leaving", () => {
  it("removes only the signed-in member and keeps the household's data", async () => {
    const [me, other] = ["leave-me@example.com", "leave-other@example.com"];
    const { deps, stub, cookie, key } = await household("leave", [me, other]);
    expect(await text(await go(request("/household", cookie), deps))).toContain(
      '<a href="/household/leave">',
    );

    const done = await go(request("/household/leave", cookie, {}), deps);
    expect(await text(done)).toContain("You've left the household");
    expect((await stub.members()).map((m) => m.address)).toEqual([other]);
    expect(await addressStub(env, me).lookup()).toEqual({ status: "unknown" });
    expect(await env.MAIL.get(key)).not.toBeNull();
  });

  it("sends the last member to delete instead", async () => {
    const { deps, cookie } = await household("leave-last", ["leave-last@example.com"]);
    const response = await go(request("/household/leave", cookie), deps);
    expect(response.headers.get("Location")).toBe("/household/delete");
  });
});
