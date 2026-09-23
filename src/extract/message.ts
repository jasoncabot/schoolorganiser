import PostalMime, { type Attachment } from "postal-mime";
import { readPptx } from "./pptx";

export interface Unreadable {
  filename: string;
  reason: "unsupported format" | "conversion failed";
}

export interface ReadMessage {
  subject: string;
  /** When the email was sent (Date header), as an ISO string, or null if missing. */
  sentAt: string | null;
  /** Body and attachment text, ready for extraction. */
  text: string;
  unreadable: Unreadable[];
}

/** Formats Workers AI toMarkdown converts (docs: workers-ai/features/markdown-conversion). */
const TO_MARKDOWN =
  /\.(pdf|jpe?g|png|webp|svg|gif|bmp|html?|xml|xlsx|xlsm|xlsb|xls|et|docx|ods|odt|csv|numbers)$/i;
const PLAIN_TEXT = /\.(txt|ics)$/i;
const PPTX = /\.pptx$/i;
/** At most this many images from one PowerPoint go to toMarkdown (each costs an AI call). */
export const MAX_PPTX_IMAGES = 5;

/** Parses a raw email and turns its body and attachments into text. */
export async function readMessage(raw: ArrayBuffer, ai: Ai): Promise<ReadMessage> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const parts: string[] = [];
  const unreadable: Unreadable[] = [];

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
    // Inline images in the body are logos and signatures, not letters.
    if (attachment.disposition === "inline" && attachment.contentId !== undefined) continue;
    const filename = attachment.filename ?? fallbackName(attachment);
    const bytes = asBytes(attachment.content);
    const text = await readAttachment(ai, filename, bytes, attachment.mimeType);
    if (typeof text === "string") {
      if (text.trim() !== "") parts.push(`Attachment: ${filename}\n${text.trim()}`);
    } else {
      unreadable.push({ filename, reason: text.reason });
    }
  }

  const date = email.date === undefined ? NaN : Date.parse(email.date);
  return {
    subject: email.subject?.trim() ?? "",
    sentAt: Number.isNaN(date) ? null : new Date(date).toISOString(),
    text: parts.join("\n\n"),
    unreadable,
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
