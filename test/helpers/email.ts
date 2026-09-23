export interface FakeMessage extends ForwardableEmailMessage {
  /** Addresses the message was forwarded to. */
  forwarded: string[];
  /** Reasons passed to setReject(). */
  rejected: string[];
  /** Number of replies sent. */
  replies: number;
}

/** A stand-in for the ForwardableEmailMessage the runtime passes to email(). */
export function fakeMessage(options: {
  from?: string;
  to: string;
  headers?: [string, string][];
  body?: string;
}): FakeMessage {
  const forwarded: string[] = [];
  const rejected: string[] = [];
  const raw = new Blob([options.body ?? ""]).stream();
  const message = {
    from: options.from ?? "parent@example.com",
    to: options.to,
    headers: new Headers(options.headers ?? []),
    raw,
    rawSize: (options.body ?? "").length,
    forwarded,
    rejected,
    replies: 0,
    setReject: (reason: string) => {
      rejected.push(reason);
    },
    forward: (rcptTo: string) => {
      forwarded.push(rcptTo);
      return Promise.resolve({ messageId: "fake" });
    },
    reply: () => {
      message.replies++;
      return Promise.resolve({ messageId: "fake" });
    },
  };
  return message;
}

export const CLOUDFLARE_PASS: [string, string] = [
  "ARC-Authentication-Results",
  "i=1; mx.cloudflare.net; dkim=pass header.d=example.com header.s=s1 header.b=abc; dmarc=pass header.from=example.com policy.dmarc=reject; spf=pass (mx.cloudflare.net: domain of parent@example.com designates 192.0.2.1 as permitted sender) smtp.mailfrom=parent@example.com; arc=none smtp.remote-ip=192.0.2.1",
];
