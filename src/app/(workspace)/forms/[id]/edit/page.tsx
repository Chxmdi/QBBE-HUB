import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { FormBuilder } from "@/features/forms/components/form-builder";
import type { FormField } from "@/features/forms/fields";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const metadata: Metadata = { title: "Edit form" };
export const dynamic = "force-dynamic";

export default async function EditFormPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminAal2();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createSupabasePageClient();
  const { data: form } = await supabase
    .from("form_definition")
    .select("id, title, description, audience, requires_signature, status, fields")
    .eq("id", id)
    .maybeSingle();
  if (!form) notFound();
  if (form.status !== "draft") redirect(`/forms/${id}`);

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Forms", href: "/forms" },
          { label: form.title, href: `/forms/${id}` },
          { label: "Edit" },
        ]}
      />
      <PageHeader eyebrow="Forms" title="Edit draft" />
      <FormBuilder
        initial={{
          id,
          title: form.title,
          description: form.description,
          audience: form.audience,
          requiresSignature: form.requires_signature,
          fields: form.fields as FormField[],
        }}
      />
    </div>
  );
}
