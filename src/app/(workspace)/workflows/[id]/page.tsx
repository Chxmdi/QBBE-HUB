import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { requireAdminAal2 } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { RunHistory } from "@/features/workflows/components/run-history";
import { TestRunPanel, WorkflowEditor } from "@/features/workflows/components/workflow-editor";
import { graphToEditor } from "@/features/workflows/editor-model";
import { validateGraph } from "@/features/workflows/graph";
import { workflowMessages } from "@/features/workflows/i18n";
import { getWorkflow, listRuns } from "@/features/workflows/services/workflow.queries";

export async function generateMetadata(): Promise<Metadata> {
  return { title: workflowMessages(await getLocale()).editTitle };
}
export const dynamic = "force-dynamic";

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isEnabled("wos_workflows_v2"))) notFound();
  const session = await requireAdminAal2();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const workflow = await getWorkflow(session.organizationId, id);
  if (!workflow) notFound();

  const m = workflowMessages(await getLocale());
  const f = await getFormatters();
  const graph = validateGraph(workflow.graph);
  const editor = graph.ok
    ? graphToEditor(graph.graph, { name: workflow.name, description: workflow.description, enabled: workflow.enabled })
    : null;
  const runs = await listRuns(workflow.id);

  return (
    <div className="space-y-5">
      <p className="text-sm"><Link href="/workflows" className="text-brand-fg underline-offset-2 hover:underline">{m.backToList}</Link></p>
      <PageHeader eyebrow={m.eyebrow} title={workflow.name} description={workflow.description ?? undefined} />
      {editor ? (
        <WorkflowEditor id={workflow.id} initial={editor} m={m} />
      ) : (
        <p role="alert" className="text-sm text-danger-fg">
          {m.errors.invalid.replace("{detail}", graph.ok ? "" : graph.issues[0].message)}
        </p>
      )}
      <TestRunPanel id={workflow.id} m={m} defaultObjectId="" />
      <RunHistory runs={runs} m={m} f={f} timeZone={session.timeZone} />
    </div>
  );
}
