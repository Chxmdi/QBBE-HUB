import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requireAdminAal2 } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { WorkflowEditor } from "@/features/workflows/components/workflow-editor";
import { emptyEditorState } from "@/features/workflows/editor-model";
import { workflowMessages } from "@/features/workflows/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: workflowMessages(await getLocale()).newTitle };
}
export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  if (!(await isEnabled("wos_workflows_v2"))) notFound();
  await requireAdminAal2();
  const m = workflowMessages(await getLocale());
  return (
    <div>
      <p className="mb-2 text-sm"><Link href="/workflows" className="text-brand-fg underline-offset-2 hover:underline">{m.backToList}</Link></p>
      <PageHeader eyebrow={m.eyebrow} title={m.newTitle} />
      <WorkflowEditor id={null} initial={emptyEditorState()} m={m} />
    </div>
  );
}
