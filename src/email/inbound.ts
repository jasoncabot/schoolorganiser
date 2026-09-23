import { cloudflareAuthResults, senderIsAuthenticated } from "./auth";

/** Addresses we accept, by local part. Everything else is dropped. */
export type Mailbox = "hello" | "privacy";

export function mailboxFor(to: string): Mailbox | null {
  const local = to.toLowerCase().split("@")[0];
  return local === "hello" || local === "privacy" ? local : null;
}

export interface InboundEnv {
  PRIVACY_FORWARD_TO: string;
}

/**
 * Handles one inbound message. Never logs addresses or content: only which mailbox,
 * what happened and the authentication verdicts.
 */
export async function handleInbound(
  message: ForwardableEmailMessage,
  env: InboundEnv,
): Promise<void> {
  const mailbox = mailboxFor(message.to);
  const auth = cloudflareAuthResults(message.headers);
  const log = (outcome: string): void => {
    console.log("inbound email", { mailbox, outcome, auth });
  };

  if (mailbox === null) {
    log("dropped: unknown mailbox");
    return;
  }
  if (!senderIsAuthenticated(auth)) {
    log("dropped: sender not authenticated");
    return;
  }
  if (mailbox === "privacy") {
    await message.forward(env.PRIVACY_FORWARD_TO);
    log("forwarded");
    return;
  }
  // hello@: verification, storage and processing arrive in plan steps 3 to 5.
  log("accepted: not yet processed");
}
