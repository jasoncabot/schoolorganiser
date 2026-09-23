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

/**
 * A minimal one-page PDF with a text layer: each line is drawn at (x, y) in points.
 * Offsets in the cross-reference table are computed, so pdf.js reads it like any other PDF.
 */
export function pdf(lines: { text: string; x: number; y: number }[]): Uint8Array {
  const escape = (t: string): string =>
    t.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = lines
    .map((l) => `BT /F1 10 Tf ${String(l.x)} ${String(l.y)} Td (${escape(l.text)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${String(i + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
