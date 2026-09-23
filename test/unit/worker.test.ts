import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("worker", () => {
  it("serves the home page", async () => {
    const response = await exports.default.fetch("http://localhost/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("School Organiser");
  });

  it("runs the Household agent with SQLite storage", async () => {
    const stub = env.HOUSEHOLD.getByName("household-worker-test");
    const tables = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec("SELECT 1 AS ok").one(),
    );
    expect(tables).toEqual({ ok: 1 });
  });
});
