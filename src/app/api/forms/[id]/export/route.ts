import { z } from "zod";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answerText, csvField, type FormField } from "@/features/forms/fields";
import { FORM_EXPORT_LIMIT, readSubmissionsForExport } from "@/features/forms/services/submission.export";
import { getLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { auditUnavailableResponse, recordAudit } from "@/lib/audit-write";

/**
 * A form's submissions as CSV (#145). Owners and admins with MFA only, and
 * read through the caller's own client so row-level security decides the
 * rows. One column per question, in the form's order; money as plain
 * decimals; text neutralised against spreadsheet formula injection.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminAal2();
  const locale = await getLocale();
  const t = createTranslator(locale);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return new Response(t("forms.errors.notFound"), { status: 404 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: form } = await supabase
    .from("form_definition")
    .select("id, title, fields, requires_signature")
    .eq("id", id)
    .maybeSingle();
  if (!form) return new Response(t("forms.errors.notFound"), { status: 404 });
  // Every submission, a page at a time; above the ceiling the file is refused, never cut short.
  const { rows, error, truncated } = await readSubmissionsForExport(supabase, id);
  if (error) return new Response(t("forms.export.failed"), { status: 500 });
  if (truncated) return new Response(t("forms.export.tooMany", { max: FORM_EXPORT_LIMIT }), { status: 413 });

  const fields = form.fields as FormField[];
  const header = [
    t("forms.export.submittedAt"),
    t("forms.export.submittedBy"),
    ...fields.map((f) => f.label),
    ...(form.requires_signature ? [t("forms.export.signedBy"), t("forms.export.signedAt")] : []),
    t("forms.export.sha"),
    t("forms.export.submissionId"),
  ];
  const lines = [header.map(csvField).join(",")];
  for (const row of rows) {
    const signature = row.signature[0];
    lines.push(
      [
        row.submitted_at,
        row.submitter?.full_name ?? "",
        ...fields.map((f) => answerText(f, row.answers[f.key], true, t, locale)),
        ...(form.requires_signature ? [signature?.signer_name ?? "", signature?.signed_at ?? ""] : []),
        row.content_sha256,
        row.id,
      ]
        .map(csvField)
        .join(","),
    );
  }

  const audited = await recordAudit(supabase, {
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "forms",
    action: "form_submissions_exported",
    object_type: "form_definition",
    object_id: id,
    metadata: { rows: lines.length - 1 },
  });
  // No file without a record of who took it.
  if (!audited) return auditUnavailableResponse();

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "form";
  // The byte-order mark makes Excel read accents (Montréal, Café) correctly.
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${t("forms.export.fileSuffix")}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
