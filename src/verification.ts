import { addressStub, householdStub } from "./bindings";
import type { Deps } from "./deps";
import { verificationEmail } from "./email/outbound";
import { addDays, MAIL_DAYS, PENDING_DAYS } from "./retention";
import { signToken, verifyToken } from "./tokens";

interface VerifyPayload {
  purpose: "verify";
  address: string;
  expires: string;
}

/**
 * Emails a verification link to an address whose mail we're holding, unless one went out in
 * the last day. The link lasts as long as the held mail (PENDING_DAYS).
 */
export async function sendVerification(
  env: Env,
  deps: Deps,
  address: string,
): Promise<"sent" | "skipped"> {
  const now = deps.clock.now();
  if (!(await addressStub(env, address).claimVerificationSend(now.toISOString()))) return "skipped";
  const expires = addDays(now, PENDING_DAYS);
  const payload: VerifyPayload = { purpose: "verify", address, expires: expires.toISOString() };
  const token = await signToken(payload, env.SIGNING_KEY);
  const link = `${env.APP_ORIGIN}/verify?token=${encodeURIComponent(token)}`;
  const email = verificationEmail({ link, expires, appOrigin: env.APP_ORIGIN });
  await env.EMAIL.send({
    to: address,
    from: { email: env.SENDER_ADDRESS, name: "School Organiser" },
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  return "sent";
}

/** The address a verification token is for, or null if it's forged or expired. */
export async function readVerificationToken(
  env: Env,
  deps: Deps,
  token: string,
): Promise<string | null> {
  const payload = await verifyToken<VerifyPayload>(
    token,
    "verify",
    env.SIGNING_KEY,
    deps.clock.now(),
  );
  return payload?.address ?? null;
}

export interface Confirmation {
  status: "verified" | "already-verified";
  householdId: string;
  /** Held messages moved into the household by this call. */
  moved: number;
}

/**
 * Verifies an address: creates its household (unless it already has one) and moves any held
 * mail into it. Safe to repeat: a repeat finishes any move that was interrupted.
 */
export async function confirmVerification(
  env: Env,
  deps: Deps,
  address: string,
): Promise<Confirmation> {
  const now = deps.clock.now().toISOString();
  const addressDo = addressStub(env, address);
  let state = await addressDo.lookup();
  let status: Confirmation["status"] = "already-verified";

  if (state.status !== "verified") {
    const householdId = deps.ids.next();
    const household = await householdStub(env, householdId);
    await household.addMember(address, now);
    state = await addressDo.link(householdId, now);
    status = "verified";
  }
  if (state.status !== "verified") throw new Error("Address did not verify");

  const household = await householdStub(env, state.householdId);
  for (const held of state.pending) {
    const id = held.key.slice(held.key.lastIndexOf("/") + 1).replace(/\.eml$/, "");
    const key = `mail/${state.householdId}/${id}.eml`;
    const object = await env.MAIL.get(held.key);
    if (object !== null) {
      await env.MAIL.put(key, await object.arrayBuffer(), {
        httpMetadata: { contentType: "message/rfc822" },
      });
      // Retention runs from when we first received it, not from verification.
      await household.receive({
        id,
        key,
        receivedAt: held.receivedAt,
        expiresAt: addDays(new Date(held.receivedAt), MAIL_DAYS).toISOString(),
      });
      await env.MAIL.delete(held.key);
    }
    await addressDo.removePending(held.key);
  }
  return { status, householdId: state.householdId, moved: state.pending.length };
}
