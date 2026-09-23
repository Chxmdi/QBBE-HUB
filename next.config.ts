import type { NextConfig } from "next";

/**
 * The Supabase origins the browser is allowed to talk to.
 *
 * Derived from `NEXT_PUBLIC_SUPABASE_URL` rather than hardcoded. The list used
 * to name `http://127.0.0.1:54321` literally, which meant the application's own
 * Content Security Policy blocked any Supabase instance that was neither that
 * exact address nor `*.supabase.co` — including a local stack reached by any
 * other address, which is how this was found.
 *
 * Both the http(s) and ws(s) forms are needed: Realtime opens a WebSocket to
 * the same origin, and `connect-src` treats the schemes separately.
 */
function supabaseOrigins(): string[] {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) return [];
  try {
    const { protocol, host } = new URL(configured);
    const socket = protocol === "https:" ? "wss:" : "ws:";
    return [`${protocol}//${host}`, `${socket}//${host}`];
  } catch {
    // A malformed URL is a configuration error, but it must not take the
    // security headers down with it. The hosted entries below still apply.
    return [];
  }
}

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
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      [
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
        ...supabaseOrigins(),
        "https://accounts.google.com https://oauth2.googleapis.com",
        "https://gmail.googleapis.com https://www.googleapis.com",
        "https://*.ingest.sentry.io",
      ].join(" "),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
