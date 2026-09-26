import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/auth", "/account-inactive", "/forgot-password", "/reset-password"];

/**
 * Refreshes the Supabase session on every request and redirects
 * unauthenticated users to sign-in. Route-level gate only — data access is
 * still enforced by RLS.
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Cron/job routes authenticate with CRON_JOB_SECRET, not a user session;
  // provider webhooks authenticate with their own signatures.
  if (
    path.startsWith("/api/jobs/") ||
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // A signed-in person who opens /sign-in or /sign-up is sent on by those
  // pages themselves, not here. The proxy cannot tell a real visit from
  // Next's background prefetch of a link (Next hides those headers from it),
  // and a redirect answered to a prefetch is never read by the router: after
  // sign-in the page's "Sign up" link was prefetched, redirected to "/", and
  // left a request open indefinitely. A page's own redirect() travels inside
  // the response the router expects.

  return supabaseResponse;
}
