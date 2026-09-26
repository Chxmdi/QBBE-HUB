import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { FormAdminActions } from "@/features/forms/components/form-admin-actions";
import { FormFill } from "@/features/forms/components/form-fill";
import { FIELD_TYPE_LABELS, type FormField } from "@/features/forms/fields";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const metadata: Metadata = { title: "Form" };
export const dynamic = "force-dynamic";

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createSupabasePageClient();
  const { data: form } = await supabase
    .from("form_definition")
    .select("id, title, description, audience, requires_signature, status, fields")
    .eq("id", id)
    .maybeSingle();
  if (!form) notFound();
  const fields = form.fields as FormField[];
  const status = form.status as "draft" | "published" | "closed";

  return (
    <div>
      <Breadcrumbs items={[{ label: "Forms", href: "/forms" }, { label: form.title }]} />
      <PageHeader
        eyebrow={form.audience === "staff" ? "Staff form" : "Form"}
        title={form.title}
        description={form.description ?? undefined}
        actions={session.isAdmin ? <FormAdminActions formId={form.id} status={status} /> : null}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {status === "draft" ? <Badge>Draft: not visible to members yet</Badge> : null}
        {status === "closed" ? <Badge tone="warning">Closed: not taking submissions</Badge> : null}
        {form.requires_signature ? <Badge tone="info">Must be signed</Badge> : null}
      </div>

      {status === "published" ? (
        <FormFill
          formId={form.id}
          fields={fields}
          requiresSignature={form.requires_signature}
          organizationId={session.organizationId}
          userId={session.userId}
        />
      ) : status === "draft" ? (
        <section aria-labelledby="preview" className="card max-w-2xl p-4">
          <h2 id="preview" className="mb-3 text-[15px] font-semibold">
            Questions
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-[14px]">
            {fields.map((f) => (
              <li key={f.key}>
                <span className="font-medium">{f.label}</span>{" "}
                <span className="meta">
                  {FIELD_TYPE_LABELS[f.type]}
                  {f.required ? ", required" : ""}
                  {f.options?.length ? `: ${f.options.join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="meta">This form is closed. Your earlier submissions are listed on the Forms page.</p>
      )}
    </div>
  );
}
