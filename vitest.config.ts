import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./test/wrangler.test.jsonc" },
      // Never proxy bindings to Cloudflare: tests must run offline and give the same answer every time.
      remoteBindings: false,
      miniflare: {
        workers: [
          {
            // Built by test/global-setup.ts from test/stubs/.
            name: "schoolorganiser-stubs",
            modules: true,
            scriptPath: "./test/stubs/dist/index.js",
            compatibilityDate: "2026-09-21",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: { OUTBOX: { className: "Outbox", useSQLite: true } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ["test/unit/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    sequence: { concurrent: true, shuffle: true, seed: 1 },
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
    },
  },
});
