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
    sql.exec(
      `INSERT INTO messages (id, r2_key, received_at, expires_at, status)
       VALUES ('old', 'k-old', '2025-08-01T08:00:00.000Z', '2025-10-30T08:00:00.000Z', 'done')`,
    );
    sql.exec(
      `INSERT INTO notes (id, message_id, text, child_ids, maybe_child_ids) VALUES
       ('m1-n0', 'm1', 'Judo club on Wednesdays.', NULL, '[]'),
       ('old-n0', 'old', 'A note from long ago.', NULL, '[]')`,
    );
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
    expect(page).toMatch(
      /<h2>Sun 12 Oct<\/h2> <ul class="list"> <li> Harvest festival<br \/> <span class="text-muted">From <a href="\/household\/emails\/m1" ?>Fwd: Trip<\/a ?><\/span>/,
    );
    expect(page).toContain("<h2>Fri 5 Dec</h2>");
    expect(page).not.toContain("Already happened");
    expect(page).toContain("<h2>Worth knowing</h2>");
    expect(page).toContain("Judo club on Wednesdays.");
    expect(page).not.toContain("A note from long ago.");
  });

  it("is linked from the household page", async () => {
    const { deps, cookie } = await household("upcoming-link", ["upcoming-link@example.com"]);
    expect(await text(await go(request("/household", cookie), deps))).toContain(
      '<a href="/household/upcoming">',
    );
  });
});

describe("source emails", () => {
  it("shows what we found, the attachments and the text as formatted, and 404 for an unknown one", async () => {
    const { deps, cookie, stub } = await household("source", ["source@example.com"]);
    const body = [
      "Parents evening is on **Tuesday 14th October**.",
      "",
      "Attachment: club.docx",
      "# club.docx",
      "",
      "- Judo on Wednesdays",
      "- <b>£72</b>",
    ].join("\n");
    await runInDurableObject(stub, (_instance: Household, state) => {
      state.storage.sql.exec(
        `UPDATE messages SET body_text = ?, forwarded_by = 'source@example.com',
           attachments = '[{"filename":"club.docx","outcome":"read"},{"filename":"Menu.pdf","outcome":"missing"}]'
         WHERE id = 'm1'`,
        body,
      );
    });
    const page = await text(await go(request("/household/emails/m1", cookie), deps));
    expect(page).toContain("<h1>Fwd: Trip</h1>");
    expect(page).toContain("Received Wed 8 Oct, 9am, from source@example.com");
    expect(page).toContain("<li> Sun 12 Oct, Harvest festival </li>");
    expect(page).toContain("<li> Fri 5 Dec, Christmas fair </li>");
    expect(page).toContain('<li><a href="#section-1">club.docx</a>: read</li>');
    expect(page).toContain("<li>Menu.pdf: not attached: the forward left it out.");
    expect(page).toContain("Parents evening is on <strong>Tuesday 14th October</strong>.");
    expect(page).toContain('<h3 id="section-1">Attachment: club.docx</h3>');
    expect(page).toContain("<ul><li>Judo on Wednesdays</li><li>&lt;b&gt;£72&lt;/b&gt;</li></ul>");
    expect(page).not.toContain("# club.docx");

    const other = await household("source-other", ["source-other@example.com"]);
    const missing = await go(request("/household/emails/nope", other.cookie), other.deps);
    expect(missing.status).toBe(404);
  });
});

describe("activity", () => {
  it("lists every email, newest first, with what happened to it", async () => {
    const { deps, cookie, stub } = await household("activity", ["activity@example.com"]);
    await runInDurableObject(stub, (_instance: Household, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `UPDATE messages SET forwarded_by = 'activity@example.com', processed_at = '2025-10-08T08:01:00.000Z',
           attachments = '[{"filename":"judo.docx","outcome":"read"},{"filename":"logo.png","outcome":"skipped"},{"filename":"menu.ppt","outcome":"unreadable"},{"filename":"Club letter.docx","outcome":"missing"}]'
         WHERE id = 'm1'`,
      );
      sql.exec(
        "INSERT INTO unreadable (message_id, filename, reason) VALUES ('m1', 'menu.ppt', 'unsupported format')",
      );
      sql.exec(
        `INSERT INTO messages (id, r2_key, received_at, expires_at, status, attempts, last_error)
         VALUES ('m2', 'k2', '2025-10-09T13:05:00.000Z', '2026-01-07T13:05:00.000Z', 'failed', 3, 'UnusableExtraction')`,
      );
      sql.exec(
        `INSERT INTO messages (id, r2_key, received_at, expires_at, status, attempts, last_error)
         VALUES ('m3', 'k3', '2025-10-10T08:00:00.000Z', '2026-01-08T08:00:00.000Z', 'new', 1, 'AiError')`,
      );
    });
    const page = await text(await go(request("/household", cookie), deps));
    const section = page.slice(page.indexOf("<details"), page.indexOf("</details>"));
    expect(section).toContain("<summary>Activity</summary>");
    expect(section.indexOf("/household/emails/m3")).toBeLessThan(
      section.indexOf("/household/emails/m2"),
    );
    expect(section.indexOf("/household/emails/m2")).toBeLessThan(
      section.indexOf("/household/emails/m1"),
    );
    expect(section).toContain(
      "Received Wed 8 Oct, 9am, from activity@example.com, read Wed 8 Oct, 9:01am",
    );
    expect(section).toContain(
      '<span class="tag tag-done">Done</span> 3 items and 1 note found. 3 attachments: judo.docx (read), logo.png (skipped as a logo), menu.ppt (couldn&#39;t read). Mentions Club letter.docx, but it wasn&#39;t attached.',
    );
    expect(section).toContain("Received Thu 9 Oct, 2:05pm");
    expect(section).toContain(
      '<span class="tag tag-failed">Failed</span> Gave up after 3 attempts: UnusableExtraction.',
    );
    expect(section).toContain(
      '<span class="tag">Retrying</span> Attempt 1 of 3 failed: AiError. We&#39;ll try again within 5 minutes.',
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
