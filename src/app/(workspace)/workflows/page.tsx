import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAdminAal2 } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { fill, workflowMessages } from "@/features/workflows/i18n";
import { listWorkflows } from "@/features/workflows/services/workflow.queries";

export async function generateMetadata(): Promise<Metadata> {
  return { title: workflowMessages(await getLocale()).title };
}
export const dynamic = "force-dynamic";

/** Workflows (Workspace OS M14c), behind wos_workflows_v2. Admins only. */
export default async function WorkflowsPage() {
  if (!(await isEnabled("wos_workflows_v2"))) notFound();
  const session = await requireAdminAal2();
  const m = workflowMessages(await getLocale());
  const f = await getFormatters();
  const workflows = await listWorkflows(session.organizationId);

  return (
    <div>
      <PageHeader
        eyebrow={m.eyebrow}
        title={m.title}
        description={m.description}
        actions={
          <Link
            href="/workflows/new"
            className="inline-flex h-9.5 items-center rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
          >
            {m.newWorkflow}
          </Link>
        }
      />
      {workflows.length === 0 ? (
        <EmptyState title={m.list.empty} description={m.list.emptyHint} />
      ) : (
        <ul aria-label={m.list.label} className="divide-y divide-line rounded-(--radius-md) border border-line bg-surface">
          {workflows.map((workflow) => (
            <li key={workflow.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <Link
                  href={`/workflows/${workflow.id}`}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                  aria-label={fill(m.list.open, { name: workflow.name })}
                >
                  {workflow.name}
                </Link>
                {workflow.description ? <p className="text-[13px] text-muted">{workflow.description}</p> : null}
              </div>
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <span>
                  {workflow.lastRunAt
                    ? fill(m.list.lastRun, { when: f.dateTime(workflow.lastRunAt, session.timeZone) })
                    : m.list.neverRun}
                </span>
                <Badge tone={workflow.enabled ? "success" : "neutral"}>
                  {workflow.enabled ? m.list.on : m.list.off}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
