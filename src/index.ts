export { Address } from "./address";
export { Household } from "./household";

export default {
  async fetch(request, env): Promise<Response> {
    // Static pages and CSS are served by Workers static assets before this runs.
    return env.ASSETS.fetch(request);
  },

  email(message): void {
    // Inbound mail is handled in plan step 3. Until then nothing is stored or replied to.
    console.log("email received", { size: message.rawSize });
  },
} satisfies ExportedHandler<Env>;
