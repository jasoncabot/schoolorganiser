import { env } from "cloudflare:workers";
import type { SentEmail } from "../stubs/index";

interface EmailStubRpc {
  sentTo(address: string): Promise<SentEmail[]>;
}

/** Everything the email stub has "sent" to one address, oldest first. */
export async function sentTo(address: string): Promise<SentEmail[]> {
  return (env.EMAIL as unknown as EmailStubRpc).sentTo(address);
}
