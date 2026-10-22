import type { NextConfig } from "next";

/**
 * Sent on every response. The Content Security Policy is not here: it names a
 * fresh nonce per request, so the proxy (src/proxy.ts) sends it, built by
 * src/lib/security/content-security-policy.ts.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

// The commit being built (Dockerfile build argument). Each release then has
// its own deployment id, so a tab opened before a release reloads instead of
// calling server actions the new build no longer has. Local and CI builds
// name no commit and keep Next's default.
const commit = process.env.APP_COMMIT?.trim();
const deploymentId = commit && /^[0-9a-f]{7,40}$/i.test(commit) ? commit : undefined;

const nextConfig: NextConfig = {
  deploymentId,
  reactStrictMode: true,
  poweredByHeader: false,
  // The container image (Dockerfile) runs the self-contained server Next.js
  // writes to .next/standalone. Only that build asks for it: `next start`,
  // which CI and local runs use, does not serve a standalone build.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
