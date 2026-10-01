import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { requireAdminAal2 } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { loadCatalog } from "@/lib/query/run";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { JsonWorkflowEditor, StopSwitch } from "@/features/workflows/components/advanced-controls";
import { FailureHistory } from "@/features/workflows/components/failure-history";
import { SigningKeyPanel } from "@/features/workflows/components/review-and-signing";
import { RunHistory } from "@/features/workflows/components/run-history";
import { TestRunPanel } from "@/features/workflows/components/test-run-panel";
import { WorkflowEditor } from "@/features/workflows/components/workflow-editor";
import { graphToEditor } from "@/features/workflows/editor-model";
import { validateGraph } from "@/features/workflows/graph";
import { fill, workflowMessages } from "@/features/workflows/i18n";
import {
  getWorkflow,
  listFailedRuns,
  listRecentEvents,
  listRuns,
  listWorkflowNames,
  parseOutcomeFilter,
} from "@/features/workflows/services/workflow.queries";

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
  searchParams: Promise<{ mode?: string; outcome?: string }>;
}) {
  if (!(await isEnabled("wos_workflows_v2"))) notFound();
  const session = await requireAdminAal2();
  const { id } = await params;
  const { mode, outcome: rawOutcome } = await searchParams;
  const outcome = parseOutcomeFilter(rawOutcome);
  if (!z.string().uuid().safeParse(id).success) notFound();
  const workflow = await getWorkflow(session.organizationId, id);
  if (!workflow) notFound();

  const locale = await getLocale();
  const m = workflowMessages(locale);
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
  const trigger = graph.ok ? graph.graph.trigger : { objectTypes: [], verbs: [] };
  const [runs, failures, workflows, recentEvents, catalog] = await Promise.all([
    listRuns(workflow.id, 50, outcome),
    listFailedRuns(workflow.id, session.organizationId),
    listWorkflowNames(session.organizationId),
    listRecentEvents(session.organizationId, trigger),
    createSupabaseServerClient().then(loadCatalog).catch(() => ({})),
  ]);
  const dateTime = (iso: string) => f.dateTime(iso, session.timeZone);

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
          <WorkflowEditor id={workflow.id} initial={editor} m={m} catalog={catalog} locale={locale} workflows={workflows} />
        </>
      )}
      <StopSwitch
        id={workflow.id}
        stoppedAt={workflow.stopped_at}
        stoppedLabel={workflow.stopped_at ? f.dateTime(workflow.stopped_at, session.timeZone) : ""}
        m={m}
      />
      {graph.ok && graph.graph.steps.some((step) => step.kind === "webhook") ? <SigningKeyPanel id={workflow.id} m={m} /> : null}
      <TestRunPanel
        id={workflow.id}
        m={m}
        defaultObjectId=""
        objectType={trigger.objectTypes[0] ?? "task"}
        changedProperty={graph.ok ? graph.graph.trigger.changedProperty ?? "" : ""}
        recentEvents={recentEvents}
        dateTime={dateTime}
      />
      <FailureHistory runs={failures} m={m} f={f} timeZone={session.timeZone} scope="workflow" />
      <RunHistory runs={runs} m={m} f={f} timeZone={session.timeZone} workflowId={workflow.id} outcome={outcome} />
    </div>
  );
}
