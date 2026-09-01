import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  // Next 16 publishes native flat configs. Loading them directly avoids the
  // legacy compatibility bridge, which cannot validate their plugin objects.
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      "**/node_modules/**",
      // Globbed rather than anchored: build output is generated in any
      // worktree too, and linting a minified bundle fails the gate on code
      // nobody wrote.
      "**/.next/**",
      "**/out/**",
      "coverage/**",
      "next-env.d.ts",
      "supabase/.temp/**",
      // Agent worktrees and local tool state; never source.
      ".claude/**",
    ],
  },
];

export default eslintConfig;
