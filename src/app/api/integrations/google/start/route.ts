import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { googleScopeString, type GoogleIntegrationProvider } from "@/features/inbox/services/google-oauth";

export const dynamic = "force-dynamic";

function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!googleConfigured()) {
    return NextResponse.json(
      {
        error:
          "Gmail is not connected. An administrator must set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI.",
      },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const requested = url.searchParams.get("provider");
  const provider: GoogleIntegrationProvider =
    requested === "google_calendar" || requested === "google_drive"
      ? requested
      : "gmail";
  const state = `${provider}:${session.userId}:${crypto.randomUUID()}`;
  const cookieStore = await cookies();
  cookieStore.set("qbbe_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  auth.searchParams.set("redirect_uri", process.env.GOOGLE_OAUTH_REDIRECT_URI!);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", googleScopeString(provider));
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("state", state);
  return NextResponse.redirect(auth);
}
