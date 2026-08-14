import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

const SCOPES: Record<string, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  google_calendar: "https://www.googleapis.com/auth/calendar.readonly",
};

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
  const provider = url.searchParams.get("provider") === "google_calendar"
    ? "google_calendar"
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
  auth.searchParams.set("scope", SCOPES[provider]);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("state", state);
  return NextResponse.redirect(auth);
}
