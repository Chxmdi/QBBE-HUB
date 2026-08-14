import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: process.env.QA_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    // The sandbox routes outbound HTTPS through an agent proxy; the browser
    // needs it to reach Supabase. Local traffic bypasses it.
    proxy: process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" }
      : undefined,
    ignoreHTTPSErrors: true,
    launchOptions: {
      executablePath:
        process.env.QA_CHROME_PATH ??
        "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
