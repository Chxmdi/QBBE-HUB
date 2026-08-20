import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  // Next 16 publishes native flat configs. Loading them directly avoids the
  // legacy compatibility bridge, which cannot validate their plugin objects.
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "next-env.d.ts",
      "supabase/.temp/**",
    ],
  },
];

export default eslintConfig;
