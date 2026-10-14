import { after, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { runJob } from "@/features/jobs/services/runner";
import { parseZeffyEvent, zeffySignatureIsValid } from "@/features/zeffy/signature";
import { savePayments } from "@/features/zeffy/sync";

export const dynamic = "force-dynamic";

/** Zeffy's events are small JSON documents; anything far larger is not one. */
const MAX_BODY_BYTES = 1_000_000;

/**
 * Receives Zeffy's webhook deliveries (payments and contacts created, changed
 * or deleted). The signature is checked over the raw body before anything is
 * parsed. Each event is recorded once by Zeffy's event id, so a retried
 * delivery does nothing. A completed payment carries the whole payment and is
 * saved at once; every other event is applied by the `zeffy-events` job,
 * started right after this answers, which reads the current state from Zeffy.
 *
 * A non-2xx answer makes Zeffy retry (up to 3 days), so only failures that a
 * retry can fix answer one.
 */
export async function POST(request: Request) {
  const secret = process.env.ZEFFY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Zeffy webhook is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Event too large." }, { status: 413 });
  }
  if (!zeffySignatureIsValid(rawBody, request.headers.get("zeffy-signature"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }
  const event = parseZeffyEvent(payload);
  if (!event) return NextResponse.json({ ok: true, ignored: true });

  const limit = await checkRateLimit({ action: "zeffy:webhook", subject: "zeffy", ...RATE_LIMITS["zeffy:webhook"] });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many events." }, { status: 429 });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch {
    return NextResponse.json({ error: "Service role is not configured." }, { status: 503 });
  }

  const { data: connection, error: connectionError } = await supabase
    .from("integration_connection")
    .select("organization_id")
    .eq("provider", "zeffy")
    .is("user_id", null)
    .neq("status", "disconnected")
    .limit(1)
    .maybeSingle();
  if (connectionError) {
    return NextResponse.json({ error: "Could not find the Zeffy connection." }, { status: 500 });
  }
  // Not connected: nothing to file it under. The sync brings everything in
  // once an admin connects Zeffy, so dropping the event loses nothing.
  if (!connection) return NextResponse.json({ ok: true, ignored: true });
  const organizationId = (connection as { organization_id: string }).organization_id;

  const { error: insertError } = await supabase.from("zeffy_webhook_event").insert({
    event_id: event.id,
    organization_id: organizationId,
    event_type: event.type,
    resource_id: event.resourceId,
  });
  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }

  const now = new Date();
  await supabase.from("zeffy_sync_state").upsert(
    { organization_id: organizationId, last_webhook_at: now.toISOString(), updated_at: now.toISOString() },
    { onConflict: "organization_id" },
  );

  if (event.payment) {
    try {
      await savePayments({ db: supabase, organizationId, now }, [event.payment]);
      await supabase
        .from("zeffy_webhook_event")
        .update({ processed_at: now.toISOString(), attempts: 1 })
        .eq("event_id", event.id);
      return NextResponse.json({ ok: true });
    } catch {
      // The event is recorded; the job below reads the payment from Zeffy.
    }
  }

  after(async () => {
    try {
      const outcome = await runJob("zeffy-events");
      if (outcome.status === "failed") {
        console.error("Zeffy events worker failed", { runId: outcome.runId, error: outcome.error });
      }
    } catch (cause) {
      console.error("Zeffy events worker could not start", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });

  return NextResponse.json({ ok: true });
}
