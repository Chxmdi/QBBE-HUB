import { defineConfig, devices } from "@playwright/test";

/**
 * Wave 0 editor spikes (W0-5, W0-6). Kept apart from playwright.config.ts so
 * neither CI nor `npx playwright test` runs them: they need a build started
 * with ENABLE_DEV_SPIKES=1 against the local Supabase stack, and the spike
 * table from scripts/spikes/apply-spike-schema.sh. See
 * docs/design/spikes/W0-5-editor-accessibility.md for how to run them.
 */
export default defineConfig({
  testDir: "./tests/spikes",
  testMatch: /.*\.spike\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 300_000,
  use: {
    baseURL: process.env.QA_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    proxy: process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" }
      : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : undefined,
      },
    },
  ],
});
