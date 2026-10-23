import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  // Next 16 publishes native flat configs. Loading them directly avoids the
  // legacy compatibility bridge, which cannot validate their plugin objects.
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    // Browser specs take `test` from the suite's own fixtures, which wait for a
    // page to finish hydrating before handing it back. Playwright's raw `test`
    // does not, and a control that has rendered but not hydrated accepts a
    // click and does nothing with it — the lost click behind #80. The rule is
    // here because the failure is silent: nothing in a run says the click went
    // nowhere, so forgetting the import costs a day of looking in the wrong
    // place rather than a red test.
    //
    // Helper modules beside the specs are deliberately not covered: they define
    // the fixtures, or want only types.
    files: ["tests/e2e/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              message:
                "Import test, expect and Playwright's types from ./fixtures instead — see tests/e2e/fixtures.ts and #80.",
            },
          ],
        },
      ],
    },
  },
  {
    // A promise nobody awaits or catches in a component is a failure nobody
    // sees: a save that rejects leaves its button busy and says nothing. Use
    // useServerAction / runServerAction (src/lib/use-server-action.ts), or
    // `void` a call whose failure is handled inside it.
    // tests/unit/stuck-busy.test.ts checks the busy-flag side of the same bug.
    files: ["src/**/*.tsx"],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    },
  },
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
      // OCR engine copied out of node_modules (scripts/copy-ocr-assets.mjs).
      "public/ocr/**",
      // PDF reader copied out of node_modules by the same script.
      "public/pdf/**",
      // Agent worktrees and local tool state; never source.
      ".claude/**",
    ],
  },
];

export default eslintConfig;
