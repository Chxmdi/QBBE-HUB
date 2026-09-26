import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { FormBuilder } from "@/features/forms/components/form-builder";
import { requireAdminAal2 } from "@/lib/auth";

export const metadata: Metadata = { title: "New form" };
export const dynamic = "force-dynamic";

export default async function NewFormPage() {
  await requireAdminAal2();
  return (
    <div>
      <Breadcrumbs items={[{ label: "Forms", href: "/forms" }, { label: "New form" }]} />
      <PageHeader
        eyebrow="Forms"
        title="New form"
        description="Lay out the questions, then save a draft. Once you publish it, its questions are frozen so every answer can be read against exactly what was asked."
      />
      <FormBuilder />
    </div>
  );
}
