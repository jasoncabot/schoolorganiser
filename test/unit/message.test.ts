import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_PPTX_IMAGES, readMessage } from "../../src/extract/message";
import { mimeEmail, pptx } from "../helpers/mime";
import { registerMarkdown } from "../helpers/stubs";

const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("readMessage", () => {
  it("reads the subject, sent time and body", async () => {
    const message = await readMessage(
      encode(
        mimeEmail({
          from: "p@example.com",
          subject: "Fwd: Harvest festival",
          text: "Harvest festival on Friday.",
        }),
      ),
      env.AI,
    );
    expect(message).toEqual({
      subject: "Fwd: Harvest festival",
      sentAt: "2025-09-29T15:10:00.000Z",
      text: "Harvest festival on Friday.",
      unreadable: [],
    });
  });

  it("converts PDF and Word attachments with toMarkdown", async () => {
    await registerMarkdown("%PDF trip letter", "# Year 3 trip\nThursday 16 October");
    await registerMarkdown("PK docx consent form", "Return by Friday 10 October");
    const message = await readMessage(
      encode(
        mimeEmail({
          from: "p@example.com",
          subject: "Trip",
          text: "See attached.",
          attachments: [
            {
              filename: "Trip letter.pdf",
              contentType: "application/pdf",
              bytes: "%PDF trip letter",
            },
            {
              filename: "consent.docx",
              contentType: "application/octet-stream",
              bytes: "PK docx consent form",
            },
          ],
        }),
      ),
      env.AI,
    );
    expect(message.text).toBe(
      "See attached.\n\nAttachment: Trip letter.pdf\n# Year 3 trip\nThursday 16 October\n\nAttachment: consent.docx\nReturn by Friday 10 October",
    );
  });

  it("reads PowerPoint slides and a limited number of their images", async () => {
    const images = Object.fromEntries(
      Array.from({ length: MAX_PPTX_IMAGES + 2 }, (_, i) => [
        `image${String(i + 1)}.png`,
        new Uint8Array([200, i]),
      ]),
    );
    for (let i = 0; i < MAX_PPTX_IMAGES; i++) {
      await registerMarkdown(new Uint8Array([200, i]), `Poster ${String(i + 1)}`);
    }
    const deck = await pptx([["Christmas fair", "Saturday 6 December"]], { media: images });
    const message = await readMessage(
      encode(
        mimeEmail({
          from: "p@example.com",
          subject: "Fair",
          attachments: [
            {
              filename: "Fair.pptx",
              contentType:
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              bytes: deck,
            },
          ],
        }),
      ),
      env.AI,
    );
    expect(message.text).toBe(
      "Attachment: Fair.pptx\nSlide 1\nChristmas fair\nSaturday 6 December\n\nPoster 1\n\nPoster 2\n\nPoster 3\n\nPoster 4\n\nPoster 5",
    );
  });

  it("records old Office formats and unknown files as unreadable", async () => {
    const message = await readMessage(
      encode(
        mimeEmail({
          from: "p@example.com",
          subject: "Old files",
          text: "Body",
          attachments: [
            {
              filename: "trip.ppt",
              contentType: "application/vnd.ms-powerpoint",
              bytes: "old ppt",
            },
            { filename: "form.doc", contentType: "application/msword", bytes: "old doc" },
            { contentType: "application/msword", bytes: "unnamed doc" },
          ],
        }),
      ),
      env.AI,
    );
    expect(message.text).toBe("Body");
    expect(message.unreadable).toEqual([
      { filename: "trip.ppt", reason: "unsupported format" },
      { filename: "form.doc", reason: "unsupported format" },
      { filename: "attachment.doc", reason: "unsupported format" },
    ]);
  });

  it("reports a supported file that fails to convert", async () => {
    const message = await readMessage(
      encode(
        mimeEmail({
          from: "p@example.com",
          subject: "Broken",
          text: "Body",
          attachments: [
            { filename: "scan.pdf", contentType: "application/pdf", bytes: "no fixture for this" },
          ],
        }),
      ),
      env.AI,
    );
    expect(message.unreadable).toEqual([{ filename: "scan.pdf", reason: "conversion failed" }]);
  });

  it("skips inline logos and reads calendar invites as text", async () => {
    const message = await readMessage(
      encode(
        mimeEmail({
          from: "p@example.com",
          subject: "Invite",
          text: "Body",
          attachments: [
            {
              filename: "logo.png",
              contentType: "image/png",
              bytes: "logo",
              inlineId: "logo@school",
            },
            {
              filename: "concert.ics",
              contentType: "text/calendar",
              bytes: "BEGIN:VEVENT\nSUMMARY:Carol concert\nEND:VEVENT",
            },
          ],
        }),
      ),
      env.AI,
    );
    expect(message.text).toBe(
      "Body\n\nAttachment: concert.ics\nBEGIN:VEVENT\nSUMMARY:Carol concert\nEND:VEVENT",
    );
    expect(message.unreadable).toEqual([]);
  });

  it("converts an HTML-only body with toMarkdown", async () => {
    const html = "<p>Disco on <b>Friday 17 October</b></p>";
    await registerMarkdown(html, "Disco on **Friday 17 October**");
    const message = await readMessage(
      encode(mimeEmail({ from: "p@example.com", subject: "Disco", html })),
      env.AI,
    );
    expect(message.text).toBe("Disco on **Friday 17 October**");
  });
});
