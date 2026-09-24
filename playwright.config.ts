import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Refuse to start when the address this build talks to Supabase on does not
  // answer. See the file for why that is a property of the build rather than
  // of the environment, and what it has cost twice.
  globalSetup: "./tests/e2e/supabase-preflight.ts",
  fullyParallel: false,
  workers: 1,
  // The watchdog turns a server that exited mid-run into a stated server
  // exit rather than a screenful of unrelated test failures (#79).
  reporter: [["list"], ["./tests/e2e/server-watchdog.ts"]],
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
  },
  projects: [
    { name: "chromium", use: {
      ...devices["Desktop Chrome"],
      launchOptions: process.env.QA_CHROME_PATH
        ? { executablePath: process.env.QA_CHROME_PATH }
        : undefined,
    } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
