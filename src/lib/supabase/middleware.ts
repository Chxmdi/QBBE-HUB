import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  VERIFIED_USER_HEADER,
  encodeVerifiedUser,
} from "@/lib/verified-user-header";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/auth", "/account-inactive", "/forgot-password", "/reset-password"];

/**
 * Refreshes the Supabase session on every request and redirects
 * unauthenticated users to sign-in. Route-level gate only — data access is
 * still enforced by RLS.
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Only this proxy may say who the verified user is. Whatever a client sent
  // under that name is dropped before anything else, on every path.
  request.headers.delete(VERIFIED_USER_HEADER);
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

  if (user && (path === "/sign-in" || path === "/sign-up")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!user) return supabaseResponse;

  // Hand the verified user to server components so they need not ask Auth a
  // second time. The forwarded request is rebuilt to carry the header, with
  // any refreshed session cookies copied across.
  request.headers.set(
    VERIFIED_USER_HEADER,
    encodeVerifiedUser({ id: user.id, email: user.email ?? "" }),
  );
  const response = NextResponse.next({ request });
  for (const cookie of supabaseResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return response;
}
