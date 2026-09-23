// Builds raw MIME emails for tests, deterministically (fixed boundary, no generated IDs).

export interface MimeAttachment {
  filename?: string;
  contentType: string;
  bytes: Uint8Array | string;
  /** Inline parts with a Content-ID are treated as body images (logos). */
  inlineId?: string;
}

export function mimeEmail(options: {
  from: string;
  subject: string;
  date?: string;
  text?: string;
  html?: string;
  attachments?: MimeAttachment[];
}): string {
  const boundary = "test-boundary-0001";
  const headers = [
    `From: Parent <${options.from}>`,
    "To: hello@school.example.com",
    `Subject: ${options.subject}`,
    `Date: ${options.date ?? "Mon, 29 Sep 2025 16:10:00 +0100"}`,
    "Message-ID: <test@example.com>",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts: string[] = [];
  if (options.text !== undefined) {
    parts.push(
      [
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        base64(options.text),
      ].join("\r\n"),
    );
  }
  if (options.html !== undefined) {
    parts.push(
      [
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        base64(options.html),
      ].join("\r\n"),
    );
  }
  for (const a of options.attachments ?? []) {
    const disposition =
      a.inlineId !== undefined
        ? "inline"
        : a.filename === undefined
          ? "attachment"
          : `attachment; filename="${a.filename}"`;
    parts.push(
      [
        `Content-Type: ${a.contentType}${a.filename === undefined ? "" : `; name="${a.filename}"`}`,
        `Content-Disposition: ${disposition}`,
        ...(a.inlineId === undefined ? [] : [`Content-ID: <${a.inlineId}>`]),
        "Content-Transfer-Encoding: base64",
        "",
        base64(a.bytes),
      ].join("\r\n"),
    );
  }
  return [...headers, "", ...parts.map((p) => `--${boundary}\r\n${p}`), `--${boundary}--`, ""].join(
    "\r\n",
  );
}

function base64(content: Uint8Array | string): string {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return (btoa(binary).match(/.{1,76}/g) ?? [""]).join("\r\n");
}

/** A minimal .pptx: slide XML (and optional notes and media) zipped the way PowerPoint does. */
export async function pptx(
  slides: string[][],
  options: { notes?: Record<number, string>; media?: Record<string, Uint8Array> } = {},
): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  const paragraph = (text: string): string =>
    `<a:p><a:r><a:t>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</a:t></a:r></a:p>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
  };
  slides.forEach((lines, i) => {
    files[`ppt/slides/slide${String(i + 1)}.xml`] = strToU8(
      `<p:sld><p:cSld><p:spTree><p:sp><p:txBody>${lines.map(paragraph).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  });
  for (const [n, text] of Object.entries(options.notes ?? {})) {
    files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(
      `<p:notes><p:txBody>${paragraph(n)}${paragraph(text)}</p:txBody></p:notes>`,
    );
  }
  for (const [name, bytes] of Object.entries(options.media ?? {}))
    files[`ppt/media/${name}`] = bytes;
  // Fixed mtime keeps the zip bytes identical on every run.
  return zipSync(files, { mtime: new Date("2025-01-01T00:00:00Z") });
}
