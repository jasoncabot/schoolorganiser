import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Bundle the AI and email stubs so Miniflare can load them as an auxiliary Worker.
// Use an absolute --outdir: Wrangler resolves parts of a relative one against different directories.
export default function setup(): void {
  execFileSync(
    "npx",
    [
      "wrangler",
      "deploy",
      "--dry-run",
      "--config",
      "test/stubs/wrangler.jsonc",
      "--outdir",
      resolve("test/stubs/dist"),
    ],
    { stdio: "ignore" },
  );
}
