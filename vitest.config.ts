import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Lowest line coverage each area may fall to (percent, unit tests only).
 * Set from a measured run on 2026-10-22, rounded down; raise with new tests.
 */
const COVERAGE_FLOORS = {
  lines: 34,
  "src/lib/**": { lines: 74 },
  "src/features/ledger/services/**": { lines: 5 },
  "src/features/payables/services/**": { lines: 0 },
  "src/features/payroll/services/**": { lines: 0 },
  "src/features/banking/services/**": { lines: 0 },
  "src/features/sales-tax/services/**": { lines: 11 },
  "src/features/finance/services/**": { lines: 0 },
  "src/features/admin/services/**": { lines: 12 },
  "src/features/auth/services/**": { lines: 0 },
  "src/features/exports/services/**": { lines: 30 },
  "src/features/jobs/services/**": { lines: 65 },
};

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    // Unit tests decide each switch themselves (vi.stubEnv); a developer's
    // shell with the Workspace OS switches on must not leak into them.
    env: { WORKSPACE_OS_FLAGS: "" },
    // `npm run test:coverage` (CI's Verify job) measures the unit suite and
    // fails when a folder falls below its floor. The floors are what the
    // suite reached when they were set, so they only stop coverage falling;
    // raise one when tests are added, never lower it to make a change pass.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.ts", "src/**/tests/**", "src/**/testing/**", "src/types/**"],
      reporter: ["text-summary", "json-summary"],
      thresholds: COVERAGE_FLOORS,
    },
  },
  // Modules under test may import stylesheets (the editor imports BlockNote's);
  // unit tests need no CSS, and the app's PostCSS config is Next's, not Vite's.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
