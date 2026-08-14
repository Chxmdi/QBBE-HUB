import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expected = cookieStore.get("qbbe_oauth_state")?.value;
  cookieStore.delete("qbbe_oauth_state");

  const fail = (message: string) =>
    NextResponse.redirect(
      new URL(`/inbox?google_error=${encodeURIComponent(message)}`, request.url),
    );

  if (!code || !state || !expected || state !== expected) {
    return fail("OAuth state mismatch. Try connecting again.");
  }
  const provider = state.startsWith("google_calendar:") ? "google_calendar" : "gmail";
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return fail("Google credentials are not configured.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return fail("Google did not issue tokens. Check the OAuth client configuration.");
  }
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) return fail("Google response was missing an access token.");

  const supabase = await createSupabaseServerClient();
  const { data: connection, error } = await supabase
    .from("integration_connection")
    .upsert(
      {
        organization_id: session.organizationId,
        user_id: session.userId,
        provider,
        status: "connected",
        last_error: null,
        last_sync_at: null,
      },
      { onConflict: "organization_id,provider,user_id" },
    )
    .select("id")
    .single();
  if (error || !connection) {
    return fail("Could not save the connection record.");
  }

  const expires = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  const secretPayload = {
    connection_id: connection.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    token_expires_at: expires,
  };
  const { error: secretError } = await supabase
    .from("integration_secret")
    .upsert(secretPayload, { onConflict: "connection_id" });
  if (secretError) {
    await supabase
      .from("integration_connection")
      .update({ status: "error", last_error: "Token store failed." })
      .eq("id", connection.id);
    return fail("Connected, but tokens could not be stored. Disconnect and retry.");
  }

  const dest = provider === "gmail" ? "/inbox?filter=mail" : "/calendar";
  return NextResponse.redirect(new URL(dest, request.url));
}
