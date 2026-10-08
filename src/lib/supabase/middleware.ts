import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// "/p" is Workspace OS public pages (V1-18): they read only the published
// copy table, as a visitor, and answer not-found while switched off.
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/auth", "/account-inactive", "/forgot-password", "/reset-password", "/p"];

/**
 * Refreshes the Supabase session on every request and redirects
 * unauthenticated users to sign-in. Route-level gate only — data access is
 * still enforced by RLS.
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Cron/job routes authenticate with CRON_JOB_SECRET, not a user session;
  // provider webhooks authenticate with their own signatures. The job-runner
  // and version health checks are read by the deploy smoke test before anyone
  // signs in; each answers a single word (a status, or the running commit). The private API (/api/v1) authenticates
  // every call with its own access token (src/features/api-tokens).
  if (
    path.startsWith("/api/jobs/") ||
    path.startsWith("/api/v1/") ||
    path === "/api/health/jobs" ||
    path === "/api/health/version" ||
    path === "/api/integrations/gmail/push" ||
    path === "/api/integrations/email/webhook"
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims() verifies the session token's signature against the project's
  // published public keys, so with asymmetric signing keys there is no Auth
  // round trip per request, background link prefetches included (#138). It
  // still refreshes an expired session, and with a legacy symmetric key it
  // falls back to asking Auth, so it is never weaker than before.
  //
  // What it cannot see is a sign-out elsewhere: a token stays valid here until
  // it expires (at most jwt_expiry, one hour). That only decides this redirect.
  // Every page still checks the session live with Auth (requireSession uses
  // getUser) and row-level security still applies to every read, so a revoked
  // session reaches no data.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // A signed-in person who opens /sign-in or /sign-up gets the form, as they
  // always have: signing in as someone else from there is a real use (a
  // shared computer) and the browser suite relies on it. A redirect here
  // also broke sign-in outright: Next hides whether a request is a real visit
  // or a background prefetch of a link, and a redirected prefetch of the
  // page's "Sign up" link left a request open indefinitely.

  return supabaseResponse;
}
