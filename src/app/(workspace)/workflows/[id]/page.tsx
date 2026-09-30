import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { requireAdminAal2 } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { JsonWorkflowEditor, StopSwitch } from "@/features/workflows/components/advanced-controls";
import { SigningKeyPanel } from "@/features/workflows/components/review-and-signing";
import { RunHistory } from "@/features/workflows/components/run-history";
import { TestRunPanel, WorkflowEditor } from "@/features/workflows/components/workflow-editor";
import { graphToEditor } from "@/features/workflows/editor-model";
import { validateGraph } from "@/features/workflows/graph";
import { fill, workflowMessages } from "@/features/workflows/i18n";
import { getWorkflow, listRuns } from "@/features/workflows/services/workflow.queries";

export async function generateMetadata(): Promise<Metadata> {
  return { title: workflowMessages(await getLocale()).editTitle };
}
export const dynamic = "force-dynamic";

const linkClass = "text-brand-fg underline-offset-2 hover:underline";

export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  if (!(await isEnabled("wos_workflows_v2"))) notFound();
  const session = await requireAdminAal2();
  const { id } = await params;
  const { mode } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const workflow = await getWorkflow(session.organizationId, id);
  if (!workflow) notFound();

  const m = workflowMessages(await getLocale());
  const f = await getFormatters();
  const meta = {
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    maxRunsPerHour: workflow.max_runs_per_hour,
  };
  const graph = validateGraph(workflow.graph);
  const editor = graph.ok ? graphToEditor(graph.graph, meta) : null;
  const asJson = mode === "json" || !editor;
  const runs = await listRuns(workflow.id);

  return (
    <div className="space-y-5">
      <p className="text-sm"><Link href="/workflows" className={linkClass}>{m.backToList}</Link></p>
      <PageHeader eyebrow={m.eyebrow} title={workflow.name} description={workflow.description ?? undefined} />
      {!graph.ok ? (
        <p role="alert" className="text-sm text-danger-fg">{fill(m.errors.invalid, { detail: graph.issues[0].message })}</p>
      ) : null}
      {asJson ? (
        <>
          <p className="text-sm">
            {editor ? <Link href={`/workflows/${workflow.id}`} className={linkClass}>{m.json.back}</Link> : m.json.unsupported}
          </p>
          <JsonWorkflowEditor
            id={workflow.id}
            m={m}
            initial={{ ...meta, description: workflow.description ?? "", graph: workflow.graph }}
          />
        </>
      ) : (
        <>
          <p className="text-sm"><Link href={`/workflows/${workflow.id}?mode=json`} className={linkClass}>{m.json.open}</Link></p>
          <WorkflowEditor id={workflow.id} initial={editor} m={m} />
        </>
      )}
      <StopSwitch
        id={workflow.id}
        stoppedAt={workflow.stopped_at}
        stoppedLabel={workflow.stopped_at ? f.dateTime(workflow.stopped_at, session.timeZone) : ""}
        m={m}
      />
      {graph.ok && graph.graph.steps.some((step) => step.kind === "webhook") ? <SigningKeyPanel id={workflow.id} m={m} /> : null}
      <TestRunPanel id={workflow.id} m={m} defaultObjectId="" />
      <RunHistory runs={runs} m={m} f={f} timeZone={session.timeZone} />
    </div>
  );
}
