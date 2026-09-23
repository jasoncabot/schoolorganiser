import { env } from "cloudflare:workers";
import type { SentEmail } from "../stubs/index";

interface EmailStubRpc {
  sentTo(address: string): Promise<SentEmail[]>;
}

interface AiStubRpc {
  registerRun(model: string, inputs: Record<string, unknown>, output: unknown): Promise<void>;
  registerMarkdown(bytes: Uint8Array, data: string): Promise<void>;
}

/** Everything the email stub has "sent" to one address, oldest first. */
export async function sentTo(address: string): Promise<SentEmail[]> {
  return (env.EMAIL as unknown as EmailStubRpc).sentTo(address);
}

/** Makes the AI stub answer this exact request with `output`. */
export async function registerAiRun(
  model: string,
  inputs: Record<string, unknown>,
  output: unknown,
): Promise<void> {
  await (env.AI as unknown as AiStubRpc).registerRun(model, inputs, output);
}

/** Makes the AI stub convert a file with these bytes to `markdown`. */
export async function registerMarkdown(
  bytes: Uint8Array | string,
  markdown: string,
): Promise<void> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  await (env.AI as unknown as AiStubRpc).registerMarkdown(data, markdown);
}
