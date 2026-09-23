import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { householdStub } from "../../src/bindings";
import { Household } from "../../src/household";
import { handleRequest } from "../../src/web/routes";
import { testDeps } from "../helpers/deps";
import { sentTo } from "../helpers/stubs";

// Sunday 12 Oct 2025, 18:00 BST.
const SUNDAY = "2025-10-12T17:00:00.000Z";
const NEXT_SUNDAY = "2025-10-19T17:00:00.000Z";

/** A household with members and one stored message with an item on Monday and an unreadable file. */
async function household(name: string, members: string[]) {
  const id = `household-${name}`;
  const stub = await householdStub(env, id);
  for (const address of members) await stub.addMember(address, "2025-10-01T08:00:00.000Z");
  await runInDurableObject(stub, (_instance: Household, state) => {
    const sql = state.storage.sql;
    sql.exec(
      `INSERT INTO messages (id, r2_key, received_at, expires_at, status, subject)
       VALUES ('m1', 'mail/x/m1.eml', '2025-10-08T08:00:00.000Z', '2026-01-06T08:00:00.000Z', 'done', 'Fwd: Harvest')`,
    );
    sql.exec(
      `INSERT INTO items (id, message_id, date, time, kind, title, confidence, expires_at, child_ids, maybe_child_ids)
       VALUES ('m1-0', 'm1', '2025-10-13', '09:15', 'event', 'Harvest festival', 'high', '2026-01-11T00:00:00.000Z', NULL, '[]')`,
    );
    sql.exec(
      `INSERT INTO messages (id, r2_key, received_at, expires_at, status)
       VALUES ('m2', 'mail/x/m2.eml', '2025-10-09T08:00:00.000Z', '2026-01-07T08:00:00.000Z', 'failed')`,
    );
    sql.exec(
      "INSERT INTO unreadable (message_id, filename, reason) VALUES ('m1', 'harvest.ppt', 'unsupported')",
    );
  });
  return stub;
}

const send = (stub: Awaited<ReturnType<typeof householdStub>>, now: string, name: string) =>
  runInDurableObject(stub, (instance: Household) => instance.sendDigest(testDeps(name, now)));

describe("sending the digest", () => {
  it("sends each member the week with a one-click stop link", async () => {
    const members = ["digest-a@example.com", "digest-b@example.com"];
    const stub = await household("send", members);
    expect(await send(stub, SUNDAY, "send")).toEqual({ sent: 2 });

    for (const address of members) {
      const [email, ...rest] = await sentTo(address);
      expect(rest).toHaveLength(0);
      expect(email?.subject).toBe("School this week: Mon 13 Oct to Sun 19 Oct");
      expect(email?.from).toEqual({
        email: "no-reply@school.example.com",
        name: "School Organiser",
      });
      expect(email?.text).toContain("Mon 13 Oct\n- Harvest festival, 9:15am\n");
      expect(email?.text).toContain(`We couldn't read harvest.ppt (in "Fwd: Harvest")`);
      const link = /Stop these emails: (\S+)/.exec(email?.text ?? "")?.[1] ?? "";
      expect(email?.headers).toEqual({
        "List-Unsubscribe": `<${link}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      });
    }
  });

  it("sends once a week and mentions each failure once", async () => {
    const address = "digest-once@example.com";
    const stub = await household("once", [address]);
    expect(await send(stub, SUNDAY, "once")).toEqual({ sent: 1 });
    expect(await send(stub, "2025-10-12T17:05:00.000Z", "once")).toEqual({ sent: 0 });
    expect(await send(stub, NEXT_SUNDAY, "once")).toEqual({ sent: 1 });

    const emails = await sentTo(address);
    expect(emails).toHaveLength(2);
    expect(emails[1]?.text).toContain("Nothing on this week.");
    expect(emails[0]?.text).toContain("We couldn't read an email forwarded on Thu 9 Oct.");
    expect(emails[1]?.text).not.toContain("harvest.ppt");
    expect(emails[1]?.text).not.toContain("forwarded on");
  });

  it("stops for a member who uses the one-click link, and only for them", async () => {
    const [stopper, keeper] = ["digest-stopper@example.com", "digest-keeper@example.com"];
    const stub = await household("stop", [stopper, keeper]);
    await send(stub, SUNDAY, "stop");
    const email = (await sentTo(stopper))[0];
    const link = /^<(.+)>$/.exec(email?.headers?.["List-Unsubscribe"] ?? "")?.[1] ?? "";

    // What a mail app sends for one-click unsubscribe (RFC 8058): no Origin, no cookies.
    const stopped = await handleRequest(
      new Request(link, {
        method: "POST",
        body: "List-Unsubscribe=One-Click",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
      env,
      testDeps("stop", SUNDAY),
    );
    expect(stopped.status).toBe(200);
    expect(await stopped.text()).toContain("Weekly emails stopped");

    expect(await send(stub, NEXT_SUNDAY, "stop")).toEqual({ sent: 1 });
    expect(await sentTo(stopper)).toHaveLength(1);
    expect(await sentTo(keeper)).toHaveLength(2);
    const stoppedAt = (await stub.members()).find((m) => m.address === stopper)?.digestStoppedAt;
    expect(stoppedAt).toBe(SUNDAY);
  });

  it("asks before stopping when the link is opened, and refuses a bad token", async () => {
    const address = "digest-ask@example.com";
    const stub = await household("ask", [address]);
    await send(stub, SUNDAY, "ask");
    const link = /Stop these emails: (\S+)/.exec((await sentTo(address))[0]?.text ?? "")?.[1] ?? "";

    const opened = await handleRequest(new Request(link), env, testDeps("ask", SUNDAY));
    expect(await opened.text()).toContain('<form method="post" action="/stop">');
    expect((await stub.members())[0]?.digestStoppedAt).toBeNull();

    const forged = await handleRequest(
      new Request("http://localhost:8787/stop?token=v1.e30.AAAA", { method: "POST" }),
      env,
      testDeps("ask", SUNDAY),
    );
    expect(forged.status).toBe(400);
  });

  it("sends nothing when every member has stopped", async () => {
    const address = "digest-none@example.com";
    const stub = await household("none", [address]);
    await stub.stopDigest(address, SUNDAY);
    expect(await send(stub, SUNDAY, "none")).toEqual({ sent: 0 });
    expect(await sentTo(address)).toHaveLength(0);
  });
});
