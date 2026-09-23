import { systemDeps } from "./deps";
import { handleInbound } from "./email/inbound";

export { Address } from "./address";
export { Household } from "./household";

export default {
  async fetch(request, env): Promise<Response> {
    // Static pages and CSS are served by Workers static assets before this runs.
    return env.ASSETS.fetch(request);
  },

  async email(message, env): Promise<void> {
    await handleInbound(message, env, systemDeps);
  },
} satisfies ExportedHandler<Env>;
