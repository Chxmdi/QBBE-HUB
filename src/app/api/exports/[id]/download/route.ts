import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isDownloadable } from "@/features/exports/schemas";
import type { ExportStatus } from "@/features/exports/schemas";

/**
 * Handing over a finished export.
 *
 * The exports bucket has no storage policies at all, so only the service role
 * can mint a signed URL for an object in it. That makes this route the single
 * gate, and the permission check has to be explicit — there is no policy
 * underneath to catch a mistake here.
 *
 * The order matters:
 *
 *   1. read the row through the *user's* client, so row-level security decides
 *      whether this person may see the export at all;
 *   2. check the clock, not the status — expiry is swept by a job, so a row
 *      can be `ready` and already past its date;
 *   3. count the download before handing over the URL, because "who took a
 *      copy" is the question asked after an incident, and a crash between
 *      minting and counting should over-count rather than under-count;
 *   4. sign for two minutes. The URL is the credential; it should not outlive
 *      the click that produced it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_SECONDS = 120;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const { id } = await params;

  // Step 1: the user's own client, so the read policy applies.
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("export_job")
    .select("id, status, storage_path, expires_at, organization_id")
    .eq("id", id)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!row.storage_path) {
    return NextResponse.json(
      { error: "That export has no file yet." },
      { status: 409 },
    );
  }
  if (
    !isDownloadable(
      { status: row.status as ExportStatus, expires_at: row.expires_at as string },
      new Date(),
    )
  ) {
    return NextResponse.json(
      { error: "That export has expired. Request a fresh one." },
      { status: 410 },
    );
  }

  const service = createSupabaseServiceClient();

  // Step 3, before step 4. One statement, so two people downloading at the
  // same moment cannot lose a count between them.
  await service.rpc("count_export_download", { p_export_id: id });

  await service.from("audit_event").insert({
    organization_id: row.organization_id,
    actor_id: session.userId,
    event_type: "data_export",
    action: "export_downloaded",
    object_type: "export_job",
    object_id: id,
  });

  const { data: signed, error } = await service.storage
    .from("exports")
    .createSignedUrl(row.storage_path as string, SIGNED_URL_SECONDS, {
      download: `qbbe-export-${id}.json`,
    });

  if (error || !signed?.signedUrl) {
    console.error(
      JSON.stringify({ event: "export.sign_failed", id, error: error?.message }),
    );
    return NextResponse.json(
      { error: "Could not prepare that download." },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
