import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  parseResendEvent,
  resendSignatureIsValid,
} from "@/features/notifications/services/email-webhook";

export const dynamic = "force-dynamic";

/**
 * Receives Resend's delivery events. A hard bounce or a complaint marks the
 * delivery bounced and puts the address on `email_suppression`, which the
 * worker checks before every send. The signature is verified over the raw
 * body before anything is parsed.
 */
export async function POST(request: Request) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Email webhook is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const valid = resendSignatureIsValid(rawBody, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, secret);
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "Invalid event." }, { status: 400 }); }

  const event = parseResendEvent(payload);
  if (event.kind === "ignored") return NextResponse.json({ ok: true, ignored: true });

  let supabase;
  try { supabase = createSupabaseServiceClient(); }
  catch { return NextResponse.json({ error: "Service role is not configured." }, { status: 503 }); }

  const detail = event.kind === "bounced"
    ? `bounced${event.permanent ? "" : " (transient)"}${event.detail ? `: ${event.detail}` : ""}`
    : "recipient reported the message as spam";

  if (event.messageId) {
    const { error } = await supabase
      .from("email_delivery")
      .update({ status: "bounced", last_error: `Provider reported: ${detail}`.slice(0, 1000) })
      .eq("provider_message_id", event.messageId);
    // A non-2xx asks the provider to redeliver, so a database hiccup cannot
    // lose the event.
    if (error) return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }

  const suppress = event.kind === "complained" || event.permanent;
  if (suppress && event.addresses.length) {
    const { error } = await supabase.from("email_suppression").upsert(
      event.addresses.map((address) => ({
        address,
        reason: event.kind,
        provider: "resend",
        provider_event_id: request.headers.get("svix-id"),
        detail: detail.slice(0, 500),
      })),
      { onConflict: "address", ignoreDuplicates: true },
    );
    if (error) return NextResponse.json({ error: "Could not record the suppression." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
