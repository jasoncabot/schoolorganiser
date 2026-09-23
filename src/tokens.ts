// Signed, expiring tokens for links we email out (verification now, sign-in later).
// Format: v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>, keyed by SIGNING_KEY.
// Tokens are not secret from their recipient, so never put anything in them they shouldn't see.

export interface TokenPayload {
  /** What the token is for, so a token for one purpose can't be used for another. */
  purpose: string;
  /** ISO time after which the token is refused. */
  expires: string;
}

const encoder = new TextEncoder();

export async function signToken(payload: TokenPayload, signingKey: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(signingKey),
    encoder.encode(body),
  );
  return `v1.${body}.${base64url(new Uint8Array(signature))}`;
}

/** The payload if the token is genuine, for this purpose and not expired; otherwise null. */
export async function verifyToken<T extends TokenPayload>(
  token: string,
  purpose: T["purpose"],
  signingKey: string,
  now: Date,
): Promise<T | null> {
  const [version, body, signature, ...rest] = token.split(".");
  if (version !== "v1" || body === undefined || signature === undefined || rest.length > 0)
    return null;
  const signatureBytes = fromBase64url(signature);
  if (signatureBytes === null) return null;
  // crypto.subtle.verify compares in constant time.
  const genuine = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(signingKey),
    signatureBytes,
    encoder.encode(body),
  );
  if (!genuine) return null;
  const json = fromBase64url(body);
  if (json === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return null;
  }
  if (!isPayload(payload) || payload.purpose !== purpose) return null;
  const expires = Date.parse(payload.expires);
  if (Number.isNaN(expires) || expires <= now.getTime()) return null;
  return payload as T;
}

function isPayload(value: unknown): value is TokenPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TokenPayload).purpose === "string" &&
    typeof (value as TokenPayload).expires === "string"
  );
}

function hmacKey(signingKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
