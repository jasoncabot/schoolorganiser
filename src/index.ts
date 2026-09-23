import { systemDeps } from "./deps";
import { handleInbound } from "./email/inbound";
import { handleRequest } from "./web/routes";

export { Address } from "./address";
export { Household } from "./household";

export default {
  async fetch(request, env): Promise<Response> {
    return handleRequest(request, env, systemDeps);
  },

  async email(message, env): Promise<void> {
    await handleInbound(message, env, systemDeps);
  },
} satisfies ExportedHandler<Env>;
