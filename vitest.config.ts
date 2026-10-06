import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    // Unit tests decide each switch themselves (vi.stubEnv); a developer's
    // shell with the Workspace OS switches on must not leak into them.
    env: { WORKSPACE_OS_FLAGS: "" },
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
