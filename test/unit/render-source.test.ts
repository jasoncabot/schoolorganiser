import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { signToken } from "../../src/tokens";
import { handleRequest } from "../../src/web/routes";
import { testDeps } from "../helpers/deps";

const NOW = "2025-10-06T08:00:00.000Z";
const token = (key: string, expires = "2025-10-06T08:05:00.000Z", purpose = "render-source") =>
  signToken({ purpose, key, expires } as { purpose: string; expires: string }, env.SIGNING_KEY);
const fetchSource = async (t: string) =>
  handleRequest(
    new Request(`http://localhost:8787/render-source?token=${encodeURIComponent(t)}`),
    env,
    testDeps("render source", NOW),
  );

describe("/render-source", () => {
  it("serves the temporary PDF copy for a valid token", async () => {
    await env.MAIL.put("render/source-ok.pdf", "%PDF-1.4 test");
    const response = await fetchSource(await token("render/source-ok.pdf"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("%PDF-1.4 test");
  });

  it("refuses expired tokens, other purposes and anything outside render/", async () => {
    await env.MAIL.put("render/source-refused.pdf", "%PDF-1.4 test");
    await env.MAIL.put("mail/household/secret.eml", "private mail");
    for (const t of [
      await token("render/source-refused.pdf", NOW),
      await token("render/source-refused.pdf", "2025-10-06T08:05:00.000Z", "sign-in"),
      await token("mail/household/secret.eml"),
      "v1.forged.token",
    ]) {
      const response = await fetchSource(t);
      expect(response.status).toBe(404);
      await response.text();
    }
  });

  it("404s once the copy has been deleted", async () => {
    const response = await fetchSource(await token("render/source-gone.pdf"));
    expect(response.status).toBe(404);
    await response.text();
  });
});
