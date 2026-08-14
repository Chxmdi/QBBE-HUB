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
    // Only pin Chromium when the environment provides an explicit path
    // (Cursor Cloud sandbox). GitHub Actions and local `npx playwright
    // install` put browsers in ~/.cache/ms-playwright; a hardcoded
    // /opt/pw-browsers path makes CI fail to launch.
    launchOptions: process.env.QA_CHROME_PATH
      ? { executablePath: process.env.QA_CHROME_PATH }
      : undefined,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
