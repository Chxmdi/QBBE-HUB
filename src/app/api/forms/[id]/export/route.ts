import { z } from "zod";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answerText, csvField, type FormField } from "@/features/forms/fields";

/**
 * A form's submissions as CSV (#145). Owners and admins with MFA only, and
 * read through the caller's own client so row-level security decides the
 * rows. One column per question, in the form's order; money as plain
 * decimals; text neutralised against spreadsheet formula injection.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_LIMIT = 10000;

interface ExportRow {
  id: string;
  submitted_at: string;
  answers: Record<string, unknown>;
  content_sha256: string;
  submitter: { full_name: string } | null;
  signature: { signer_name: string; signed_at: string }[];
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminAal2();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Form not found.", { status: 404 });
  const supabase = await createSupabaseServerClient();
  const { data: form } = await supabase
    .from("form_definition")
    .select("id, title, fields, requires_signature")
    .eq("id", id)
    .maybeSingle();
  if (!form) return new Response("Form not found.", { status: 404 });
  const { data, error } = await supabase
    .from("form_submission")
    .select("id, submitted_at, answers, content_sha256, submitter:submitted_by(full_name), signature(signer_name, signed_at)")
    .eq("form_id", id)
    .order("submitted_at", { ascending: true })
    .limit(EXPORT_LIMIT);
  if (error) return new Response("Could not export submissions. Try again.", { status: 500 });

  const fields = form.fields as FormField[];
  const header = [
    "Submitted at",
    "Submitted by",
    ...fields.map((f) => f.label),
    ...(form.requires_signature ? ["Signed by", "Signed at"] : []),
    "Content SHA-256",
    "Submission ID",
  ];
  const lines = [header.map(csvField).join(",")];
  for (const row of (data ?? []) as unknown as ExportRow[]) {
    const signature = row.signature[0];
    lines.push(
      [
        row.submitted_at,
        row.submitter?.full_name ?? "",
        ...fields.map((f) => answerText(f, row.answers[f.key], true)),
        ...(form.requires_signature ? [signature?.signer_name ?? "", signature?.signed_at ?? ""] : []),
        row.content_sha256,
        row.id,
      ]
        .map(csvField)
        .join(","),
    );
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "forms",
    action: "form_submissions_exported",
    object_type: "form_definition",
    object_id: id,
    metadata: { rows: lines.length - 1 },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "form";
  // The byte-order mark makes Excel read accents (Montréal, Café) correctly.
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-submissions-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
