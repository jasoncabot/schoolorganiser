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
  /** Domain of the envelope sender, when SPF passed (smtp.mailfrom). */
  spfDomain: string | null;
  /** Signing domains (header.d) of the DKIM signatures that passed. */
  dkimDomains: string[];
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

/**
 * Whether the sender is who the From address says.
 *
 * - DMARC pass: yes. DMARC fail: no, whatever else passed.
 * - No DMARC result (the domain publishes no DMARC record): yes only if SPF or DKIM passed
 *   for the From domain or one of its subdomains. That's the alignment check DMARC itself
 *   would make, but a little stricter because we don't use the public suffix list.
 */
export function senderIsAuthenticated(
  results: AuthResults | null,
  fromDomain: string | null,
): boolean {
  if (results === null) return false;
  if (results.dmarc === "pass") return true;
  if (results.dmarc === "fail" || fromDomain === null) return false;
  const aligned = (domain: string | null): boolean =>
    domain !== null &&
    (domain === fromDomain ||
      domain.endsWith(`.${fromDomain}`) ||
      fromDomain.endsWith(`.${domain}`));
  return (
    (results.spf === "pass" && aligned(results.spfDomain)) ||
    (results.dkim === "pass" && results.dkimDomains.some(aligned))
  );
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
  const results: AuthResults = {
    spf: "none",
    dkim: "none",
    dmarc: "none",
    spfDomain: null,
    dkimDomains: [],
  };
  for (const part of rest) {
    const match = /^(spf|dkim|dmarc)\s*=\s*([a-z]+)/i.exec(part);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const method = match[1].toLowerCase() as "spf" | "dkim" | "dmarc";
    const result = match[2].toLowerCase();
    const verdict: Verdict = result === "pass" ? "pass" : result === "none" ? "none" : "fail";
    // Several DKIM signatures: any pass is enough, so a pass is never overwritten.
    if (results[method] !== "pass") results[method] = verdict;
    if (verdict !== "pass") continue;
    if (method === "spf") results.spfDomain = domainOf(property(part, "smtp.mailfrom"));
    if (method === "dkim") {
      const d = domainOf(property(part, "header.d"));
      if (d !== null) results.dkimDomains.push(d);
    }
  }
  return results;
}

/** The value of `name=value` in a result, e.g. header.d=example.com. */
function property(part: string, name: string): string | null {
  const escaped = name.replace(".", "\\.");
  return new RegExp(`(?:^|\\s)${escaped}=([^\\s;]+)`, "i").exec(part)?.[1] ?? null;
}

/** "user@Example.com" or "Example.com" → "example.com". */
function domainOf(value: string | null): string | null {
  if (value === null) return null;
  const domain = value.slice(value.lastIndexOf("@") + 1).toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}
