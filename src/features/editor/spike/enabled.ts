/**
 * Whether the Wave 0 editor spikes (W0-5, W0-6) may be served.
 *
 * The spike route is a throwaway experiment and must never reach production
 * users. It is served in two cases only:
 *
 * - a development server (`next dev`), where NODE_ENV is not "production";
 * - a production build run on a developer machine or CI runner, when
 *   ENABLE_DEV_SPIKES=1 is set AND the app points at a loopback Supabase
 *   (127.0.0.1 or localhost). Measuring accessibility and latency on the
 *   optimised build is more honest than on the dev server, but a hosted
 *   deploy can never satisfy the loopback condition, even if someone sets
 *   the variable by mistake.
 */
export function editorSpikesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  if (env.ENABLE_DEV_SPIKES !== "1") return false;
  return isLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL);
}

function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const { hostname } = new URL(value);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}
