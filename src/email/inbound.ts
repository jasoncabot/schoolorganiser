import { addressStub, householdStub } from "../bindings";
import type { Deps } from "../deps";
import { addDays, MAIL_DAYS, PENDING_DAYS } from "../retention";
import { cloudflareAuthResults, senderIsAuthenticated } from "./auth";
import { senderAddress, sha256Hex } from "./sender";

/** Addresses we accept, by local part. Everything else is dropped. */
export type Mailbox = "hello" | "privacy";

export function mailboxFor(to: string): Mailbox | null {
  const local = to.toLowerCase().split("@")[0];
  return local === "hello" || local === "privacy" ? local : null;
}

/**
 * Handles one inbound message. Never logs addresses or content: only which mailbox,
 * what happened and the authentication verdicts.
 */
export async function handleInbound(
  message: ForwardableEmailMessage,
  env: Env,
  deps: Deps,
): Promise<void> {
  const mailbox = mailboxFor(message.to);
  const auth = cloudflareAuthResults(message.headers);
  const verdicts = auth && { spf: auth.spf, dkim: auth.dkim, dmarc: auth.dmarc };
  const log = (outcome: string): void => {
    console.log("inbound email", { mailbox, outcome, auth: verdicts });
  };

  if (mailbox === null) {
    log("dropped: unknown mailbox");
    return;
  }
  const sender = senderAddress(message.headers);
  if (sender === null) {
    log("dropped: no single From address");
    return;
  }
  if (!senderIsAuthenticated(auth, sender.slice(sender.lastIndexOf("@") + 1))) {
    log("dropped: sender not authenticated");
    return;
  }
  if (mailbox === "privacy") {
    await message.forward(env.PRIVACY_FORWARD_TO);
    log("forwarded");
    return;
  }
  log(await storeForwardedMail(message, env, deps, sender));
}

/** Stores a hello@ message in R2 and records it against the sender's address or household. */
async function storeForwardedMail(
  message: ForwardableEmailMessage,
  env: Env,
  deps: Deps,
  sender: string,
): Promise<string> {
  const now = deps.clock.now();
  const id = deps.ids.next();
  const raw = await new Response(message.raw).arrayBuffer();
  const address = addressStub(env, sender);
  const state = await address.lookup();

  if (state.status === "verified") {
    const key = `mail/${state.householdId}/${id}.eml`;
    await env.MAIL.put(key, raw, { httpMetadata: { contentType: "message/rfc822" } });
    const household = await householdStub(env, state.householdId);
    await household.receive({
      id,
      key,
      receivedAt: now.toISOString(),
      expiresAt: addDays(now, MAIL_DAYS).toISOString(),
    });
    return "stored";
  }

  // Unknown or not yet verified: hold for PENDING_DAYS. The key uses a hash, never the address.
  const key = `pending/${await sha256Hex(sender)}/${id}.eml`;
  await env.MAIL.put(key, raw, { httpMetadata: { contentType: "message/rfc822" } });
  await address.holdPending({
    key,
    receivedAt: now.toISOString(),
    expiresAt: addDays(now, PENDING_DAYS).toISOString(),
  });
  // Plan step 4 sends the verification link from here.
  return "held: sender not verified";
}
