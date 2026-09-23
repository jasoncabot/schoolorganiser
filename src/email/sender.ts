import { addressParser } from "postal-mime";

/**
 * The address in the From header, lower-cased, or null if there isn't exactly one.
 * We use From (not the envelope sender) because it's the address DMARC authenticates.
 */
export function senderAddress(headers: Headers): string | null {
  const from = headers.get("From");
  if (from === null) return null;
  const mailboxes = addressParser(from, { flatten: true });
  if (mailboxes.length !== 1) return null;
  const address = mailboxes[0]?.address?.trim().toLowerCase();
  return address !== undefined && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
