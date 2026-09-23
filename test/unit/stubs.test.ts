import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sentTo } from "../helpers/stubs";

// These two tests make the stub throw across RPC, which workerd also logs as "uncaught exception"
// and "hung". That output is expected here and nowhere else.
describe("AI stub", () => {
  it("refuses requests that have no recorded fixture", async () => {
    const run = async () => env.AI.run("@cf/example/model", { prompt: "unrecorded" });
    await expect(run()).rejects.toThrow(/No AI fixture/);
  });

  it("refuses attachments that have no recorded conversion", async () => {
    const blob = new Blob(["unrecorded"], { type: "application/pdf" });
    const convert = async () => env.AI.toMarkdown({ name: "letter.pdf", blob });
    await expect(convert()).rejects.toThrow(/No markdown fixture/);
  });
});

describe("email stub", () => {
  it("records each message against its recipient", async () => {
    await env.EMAIL.send({
      to: "parent-stub-test@example.com",
      from: "digest@school.example.com",
      subject: "Your week ahead",
      text: "Nothing on this week.",
    });

    const sent = await sentTo("Parent-Stub-Test@example.com");
    expect(sent).toEqual([
      {
        to: ["parent-stub-test@example.com"],
        from: "digest@school.example.com",
        subject: "Your week ahead",
        text: "Nothing on this week.",
      },
    ]);
  });

  it("keeps recipients apart", async () => {
    expect(await sentTo("nobody-stub-test@example.com")).toEqual([]);
  });
});
