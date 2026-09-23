import PostalMime, { type Attachment } from "postal-mime";
import { readPdfText } from "./pdf";
import { readPptx } from "./pptx";
import { MAX_RENDERED_PAGES, type PdfRenderer } from "./render";

export interface Unreadable {
  filename: string;
  reason: "unsupported format" | "conversion failed";
}

/** What happened to one attachment, for the household's activity log. */
export interface AttachmentOutcome {
  filename: string;
  outcome: "read" | "skipped" | "unreadable";
}

export interface ReadMessage {
  subject: string;
  /** When the email was sent (Date header), as an ISO string, or null if missing. */
  sentAt: string | null;
  /** Body and attachment text, ready for extraction. */
  text: string;
  /** PDF pages drawn as JPEG data URLs, in attachment and page order (at most MAX_RENDERED_PAGES). */
  images: string[];
  unreadable: Unreadable[];
  attachments: AttachmentOutcome[];
}

/** Formats Workers AI toMarkdown converts (docs: workers-ai/features/markdown-conversion). */
const TO_MARKDOWN =
  /\.(pdf|jpe?g|png|webp|svg|gif|bmp|html?|xml|xlsx|xlsm|xlsb|xls|et|docx|ods|odt|csv|numbers)$/i;
const PLAIN_TEXT = /\.(txt|ics)$/i;
const PPTX = /\.pptx$/i;
const PDF = /\.pdf$/i;
/**
 * Inline images smaller than this are skipped as logos and signatures. Larger ones may be a
 * photo of a letter. Other inline attachments are always read: iPhone Mail forwards documents
 * as inline parts with a Content-ID.
 */
export const INLINE_IMAGE_SKIP_BYTES = 50_000;
/** At most this many images from one PowerPoint go to toMarkdown (each costs an AI call). */
export const MAX_PPTX_IMAGES = 5;

/** Parses a raw email and turns its body and attachments into text, plus PDF page images. */
export async function readMessage(
  raw: ArrayBuffer,
  ai: Ai,
  renderer: PdfRenderer,
): Promise<ReadMessage> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const parts: string[] = [];
  const images: string[] = [];
  const unreadable: Unreadable[] = [];
  const attachments: AttachmentOutcome[] = [];

  const body = email.text?.trim() ?? "";
  if (body !== "") {
    parts.push(body);
  } else if (email.html !== undefined) {
    const converted = await toMarkdown(
      ai,
      "body.html",
      new TextEncoder().encode(email.html),
      "text/html",
    );
    if (converted !== null) parts.push(converted);
  }

  for (const attachment of email.attachments) {
    const filename = attachment.filename ?? fallbackName(attachment);
    const bytes = asBytes(attachment.content);
    if (
      attachment.disposition === "inline" &&
      attachment.mimeType.startsWith("image/") &&
      bytes.length < INLINE_IMAGE_SKIP_BYTES
    ) {
      attachments.push({ filename, outcome: "skipped" });
      continue;
    }
    if (PDF.test(filename) || attachment.mimeType === "application/pdf") {
      // Pages as images (Browser Run) read tables and layouts best; the text layer helps with
      // small print. Either is enough on its own.
      const pages =
        images.length < MAX_RENDERED_PAGES
          ? await renderer.render(bytes, MAX_RENDERED_PAGES - images.length)
          : null;
      const text =
        (await readPdfText(bytes)) ?? (await toMarkdown(ai, filename, bytes, "application/pdf"));
      if (pages !== null) images.push(...pages);
      const hasText = text !== null && text.trim() !== "";
      if (hasText) parts.push(`Attachment: ${filename}\n${text.trim()}`);
      else if (pages === null) unreadable.push({ filename, reason: "conversion failed" });
      attachments.push({ filename, outcome: hasText || pages !== null ? "read" : "unreadable" });
      continue;
    }
    const text = await readAttachment(ai, filename, bytes, attachment.mimeType);
    if (typeof text === "string" && text.trim() !== "") {
      parts.push(`Attachment: ${filename}\n${text.trim()}`);
      attachments.push({ filename, outcome: "read" });
    } else {
      const reason = typeof text === "string" ? "conversion failed" : text.reason;
      unreadable.push({ filename, reason });
      attachments.push({ filename, outcome: "unreadable" });
    }
  }

  const date = email.date === undefined ? NaN : Date.parse(email.date);
  return {
    subject: email.subject?.trim() ?? "",
    sentAt: Number.isNaN(date) ? null : new Date(date).toISOString(),
    text: parts.join("\n\n"),
    images,
    unreadable,
    attachments,
  };
}

async function readAttachment(
  ai: Ai,
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string | { reason: Unreadable["reason"] }> {
  if (PLAIN_TEXT.test(filename) || mimeType === "text/plain" || mimeType === "text/calendar") {
    return new TextDecoder().decode(bytes);
  }
  if (PPTX.test(filename)) {
    try {
      const pptx = readPptx(bytes);
      const images: string[] = [];
      for (const image of pptx.images.slice(0, MAX_PPTX_IMAGES)) {
        const text = await toMarkdown(ai, image.name, image.bytes, "");
        if (text !== null && text.trim() !== "") images.push(text.trim());
      }
      return [pptx.text, ...images].filter((s) => s !== "").join("\n\n");
    } catch {
      return { reason: "conversion failed" };
    }
  }
  if (TO_MARKDOWN.test(filename)) {
    return (await toMarkdown(ai, filename, bytes, mimeType)) ?? { reason: "conversion failed" };
  }
  return { reason: "unsupported format" };
}

async function toMarkdown(
  ai: Ai,
  name: string,
  bytes: Uint8Array,
  type: string,
): Promise<string | null> {
  try {
    const result = await ai.toMarkdown({ name, blob: new Blob([bytes], { type }) });
    return result.format === "error" ? null : result.data;
  } catch {
    return null;
  }
}

function asBytes(content: Attachment["content"]): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/** A name for attachments without one, so they can still be reported, e.g. "attachment.pdf". */
function fallbackName(attachment: Attachment): string {
  const extension: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/msword": "doc",
    "application/vnd.ms-powerpoint": "ppt",
    "image/jpeg": "jpg",
    "image/png": "png",
    "text/calendar": "ics",
  };
  return `attachment.${extension[attachment.mimeType] ?? "bin"}`;
}
