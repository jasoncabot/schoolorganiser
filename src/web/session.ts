import { addressStub } from "../bindings";
import type { Deps } from "../deps";
import { signToken, verifyToken } from "../tokens";

const COOKIE = "session";
const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

interface SessionPayload {
  purpose: "session";
  address: string;
  expires: string;
}

export interface Session {
  address: string;
  householdId: string;
}

/** A Set-Cookie header value that signs `address` in for SESSION_DAYS. */
export async function sessionCookie(env: Env, deps: Deps, address: string): Promise<string> {
  const expires = new Date(deps.clock.now().getTime() + SESSION_DAYS * DAY_MS);
  const payload: SessionPayload = { purpose: "session", address, expires: expires.toISOString() };
  const token = await signToken(payload, env.SIGNING_KEY);
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(SESSION_DAYS * 24 * 60 * 60)}`;
}

export const clearSessionCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/**
 * The signed-in address and its household, or null. Checks the address is still verified and in
 * a household on every request, so removing someone from a household ends their session.
 */
export async function readSession(request: Request, env: Env, deps: Deps): Promise<Session | null> {
  const token = cookie(request, COOKIE);
  if (token === null) return null;
  const payload = await verifyToken<SessionPayload>(
    token,
    "session",
    env.SIGNING_KEY,
    deps.clock.now(),
  );
  if (payload === null) return null;
  const state = await addressStub(env, payload.address).lookup();
  return state.status === "verified"
    ? { address: payload.address, householdId: state.householdId }
    : null;
}

/**
 * Whether a state-changing request came from our own pages. Cookies are SameSite=Lax already;
 * this also refuses cross-site form posts from browsers that send an Origin header.
 */
export function sameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return (
    origin === null ||
    origin === new URL(env.APP_ORIGIN).origin ||
    origin === new URL(request.url).origin
  );
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}
