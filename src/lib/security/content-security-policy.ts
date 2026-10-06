/**
 * The Content Security Policy every page is sent with.
 *
 * Built per request by the proxy (src/proxy.ts) so that `script-src` can name
 * that request's nonce instead of allowing any inline script (staging audit
 * S1). With `'strict-dynamic'` a script that carries the nonce may load the
 * application's other chunks, and nothing else runs: an HTML injection bug
 * no longer becomes running script. Next.js reads the nonce from the request
 * header and puts it on its own scripts; the theme script in the root layout
 * takes it from `x-nonce`.
 *
 * `eval` is refused in production. The development server needs it for fast
 * refresh, so it is allowed there only.
 */

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
export function supabaseOrigins(configured = process.env.NEXT_PUBLIC_SUPABASE_URL): string[] {
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

/** A fresh nonce for one request: 128 random bits, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy({
  nonce,
  development = process.env.NODE_ENV === "development",
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
}: {
  nonce: string;
  development?: boolean;
  supabaseUrl?: string;
}): string {
  const supabase = supabaseOrigins(supabaseUrl);
  const supabaseHttp = supabase.filter((origin) => origin.startsWith("http"));
  return [
    "default-src 'self'",
    [
      "script-src 'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // Receipt reading (#142 v2) compiles WebAssembly; this allows that and
      // nothing else of eval.
      "'wasm-unsafe-eval'",
      ...(development ? ["'unsafe-eval'"] : []),
    ].join(" "),
    "style-src 'self' 'unsafe-inline'",
    // Library images are signed Storage URLs on the Supabase origin, which is
    // plain http on a local stack: name it, as media-src does below.
    ["img-src 'self' data: blob: https:", ...supabaseHttp].join(" "),
    "font-src 'self' data:",
    // Video and audio blocks play https links and library files, which are
    // signed Storage URLs on the Supabase origin. Without this the rule
    // fell back to default-src 'self' and every one of them was refused.
    // Media cannot run script, so any https source is allowed, as for images.
    ["media-src 'self' blob: https:", ...supabaseHttp].join(" "),
    // Receipt reading runs Tesseract.js in a web worker loaded from /ocr on
    // this origin, and fetches its language data from 'self' (connect-src).
    // Stated so a blob: worker or a CDN script cannot slip in unnoticed.
    "worker-src 'self'",
    [
      "connect-src 'self'",
      // Only this deployment's own Supabase project. A wildcard over every
      // *.supabase.co project would let injected script send data to any
      // project at all (staging audit S3); it is kept only for a build that
      // names no project, which cannot reach Supabase anyway.
      ...(supabase.length ? supabase : ["https://*.supabase.co", "wss://*.supabase.co"]),
      "https://accounts.google.com https://oauth2.googleapis.com",
      "https://gmail.googleapis.com https://www.googleapis.com",
      "https://*.ingest.sentry.io",
    ].join(" "),
    // Allow-listed editor embeds only (M4b). Must match EMBED_FRAME_ORIGINS
    // in src/features/editor/adapter/embeds.ts; a unit test checks it.
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://docs.google.com https://drive.google.com https://www.loom.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
