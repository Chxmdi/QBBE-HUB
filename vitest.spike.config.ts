// W0-8 query engine spike: suites that need the LOCAL Supabase database with
// the spike schema applied and seeded (node scripts/spikes/w0-8-query.mjs).
// Not part of `npm test`, which must run without a database.
//
//   npx vitest run --config vitest.spike.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/lib/query/spike/**/*.dbtest.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
