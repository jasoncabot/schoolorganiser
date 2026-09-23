// Sender authentication, as judged by Cloudflare Email Routing when the message arrived.
//
// Anyone can put an Authentication-Results header in a message, so we only trust the one
// Cloudflare adds. Cloudflare prepends its headers, so it is the first value, and its
// authserv-id is mx.cloudflare.net. Anything we can't read counts as a failure.

export type Verdict = "pass" | "fail" | "none";

export interface AuthResults {
  spf: Verdict;
  dkim: Verdict;
  dmarc: Verdict;
}

const TRUSTED_AUTHSERV_ID = "mx.cloudflare.net";

/**
 * Cloudflare's own results, or null if they're missing or unreadable.
 * Checks ARC-Authentication-Results (i=1) first, then Authentication-Results.
 */
export function cloudflareAuthResults(headers: Headers): AuthResults | null {
  const arc = firstValue(headers.get("ARC-Authentication-Results"), /,\s*(?=i=\d+\s*;)/);
  if (arc !== null) {
    const match = /^i=1\s*;\s*(.*)$/s.exec(arc);
    if (match?.[1] !== undefined) {
      const results = parse(match[1]);
      if (results !== null) return results;
    }
  }
  const plain = firstValue(headers.get("Authentication-Results"), /,\s*(?=[a-z0-9.-]+\s*;)/i);
  return plain === null ? null : parse(plain);
}

/** DMARC pass means SPF or DKIM passed and aligned with the From domain. */
export function senderIsAuthenticated(results: AuthResults | null): boolean {
  return results?.dmarc === "pass";
}

/** Headers.get() joins repeated headers with ", ". Keep only the first (topmost) value. */
function firstValue(joined: string | null, nextValueStart: RegExp): string | null {
  if (joined === null) return null;
  return joined.split(nextValueStart)[0]?.trim() ?? null;
}

/** Parses "mx.cloudflare.net; spf=pass ...; dkim=pass ...; dmarc=pass ..." (RFC 8601). */
function parse(value: string): AuthResults | null {
  const [authservId, ...rest] = value.split(";").map((part) => part.trim());
  if (authservId?.split(/\s+/)[0]?.toLowerCase() !== TRUSTED_AUTHSERV_ID) return null;
  const results: AuthResults = { spf: "none", dkim: "none", dmarc: "none" };
  for (const part of rest) {
    const match = /^(spf|dkim|dmarc)\s*=\s*([a-z]+)/i.exec(part);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const method = match[1].toLowerCase() as keyof AuthResults;
    const result = match[2].toLowerCase();
    const verdict: Verdict = result === "pass" ? "pass" : result === "none" ? "none" : "fail";
    // Several DKIM signatures: any pass is enough, so a pass is never overwritten.
    if (results[method] !== "pass") results[method] = verdict;
  }
  return results;
}
