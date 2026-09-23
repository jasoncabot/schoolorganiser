import { defineConfig, devices } from "@playwright/test";

const port = 8787;

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: "retain-on-failure",
    timezoneId: "Europe/London",
    locale: "en-GB",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Some sandboxes ship a Chromium build that doesn't match this Playwright version.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
      },
    },
  ],
  webServer: {
    // The Worker plus the AI and email stubs, all local (see docs/testing.md).
    command: `npx wrangler dev -c test/wrangler.test.jsonc -c test/stubs/wrangler.jsonc --ip 127.0.0.1 --port ${String(port)}`,
    url: `http://127.0.0.1:${String(port)}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
