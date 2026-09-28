import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { CompleteFollowUpButton } from "@/features/crm/components/complete-follow-up-button";
import { FollowUpTaskButton } from "@/features/crm/components/follow-up-task-button";
import { CrmOrganizationDialog } from "@/features/crm/components/crm-organization-dialog";
import { createCrmContact, createFollowUp } from "@/features/crm/services/crm.commands";
import {
  DecisionsExpected,
  PipelineTotals,
} from "@/features/crm/components/pipeline-summary";
import { getPipeline } from "@/features/crm/services/opportunity.queries";
import { requireSession, NO_ACCESS_REDIRECT } from "@/lib/auth";
import { calendarDateInZone } from "@/lib/time";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { categoryLabel } from "@/features/crm/labels";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { CrmFollowUp, CrmOrganization } from "@/types/entities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.title") };
}
export const dynamic = "force-dynamic";

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const session = await requireSession();
  // Whether a follow-up is overdue is a shared judgement, so it is answered in
  // the workspace's zone — and answered once, because the pipeline query and
  // the row labels below both read it. Two derivations from the server's UTC
  // clock is how a row came to read "Overdue" under a heading that disagreed.
  const now = new Date();
  const today =
    calendarDateInZone(now, session.timeZone) ?? now.toISOString().slice(0, 10);
  if (!session.isStaff) redirect(NO_ACCESS_REDIRECT);
  const params = await searchParams;
  const supabase = await createSupabasePageClient();
  const [t, format] = await Promise.all([getT(), getFormatters()]);

  const [{ data: organizations }, { data: followUps }, pipeline] = await Promise.all([
    supabase
      .from("crm_organization")
      .select(
        "id, name, category, website, owner_id, status, notes, created_at, owner:owner_id(id, full_name, email, avatar_url, title, timezone)",
      )
      .order("name")
      .limit(200),
    supabase
      .from("crm_follow_up")
      .select(
        "id, crm_organization_id, owner_id, title, due_at, status, task_id, crm_organization:crm_organization_id(id, name)",
      )
      .eq("status", "open")
      .order("due_at")
      .limit(20),
    getPipeline(today),
  ]);

  const orgList = (organizations ?? []) as unknown as CrmOrganization[];
  const followUpList = (followUps ?? []) as unknown as CrmFollowUp[];
  const organizationOptions = orgList.map((organization) => ({
    value: organization.id,
    label: organization.name,
  }));

  return (
    <div>
      <PageHeader
        eyebrow={t("crm.eyebrow")}
        title={t("crm.title")}
        description={t("crm.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <CrmOrganizationDialog defaultOpen={params.create === "organization"} />
            {organizationOptions.length > 0 ? <EntityFormDialog
              triggerLabel={t("crm.contacts.newContact")}
              triggerVariant="secondary"
              title={t("crm.contacts.addCrmTitle")}
              submitLabel={t("crm.contacts.submit")}
              defaultOpen={params.create === "contact"}
              action={createCrmContact}
              fields={[
                {
                  name: "crmOrganizationId",
                  label: t("crm.fields.organization"),
                  type: "select",
                  required: true,
                  options: organizationOptions,
                },
                { name: "fullName", label: t("crm.fields.name"), type: "text", required: true },
                { name: "roleTitle", label: t("crm.fields.role"), type: "text" },
                { name: "email", label: t("crm.fields.email"), type: "email" },
                { name: "phone", label: t("crm.fields.phone"), type: "text" },
              ]}
            /> : null}
            {organizationOptions.length > 0 ? <EntityFormDialog
              triggerLabel={t("crm.followUps.newFollowUp")}
              triggerVariant="secondary"
              title={t("crm.followUps.addCrmTitle")}
              submitLabel={t("crm.followUps.submit")}
              defaultOpen={params.create === "follow-up"}
              action={createFollowUp}
              fields={[
                {
                  name: "crmOrganizationId",
                  label: t("crm.fields.organization"),
                  type: "select",
                  required: true,
                  options: organizationOptions,
                },
                { name: "title", label: t("crm.fields.followUp"), type: "text", required: true },
                { name: "dueAt", label: t("crm.fields.dueDate"), type: "date", required: true },
              ]}
            /> : null}
          </div>
        }
      />

      {organizationOptions.length === 0 && ["contact", "follow-up"].includes(params.create ?? "") ? (
        <p role="status" className="mb-5 rounded-(--radius-sm) bg-surface-soft px-3 py-2 text-[13px] text-muted">
          {t("crm.createOrgFirst")}
        </p>
      ) : null}

      <PipelineTotals pipeline={pipeline} />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <section aria-labelledby="crm-orgs">
          <h2 id="crm-orgs" className="section-heading mb-3">
            {t("crm.organizations")}
          </h2>
          {orgList.length === 0 ? (
            <EmptyState
              icon={<Handshake />}
              title={t("crm.emptyTitle")}
              description={t("crm.emptyDescription")}
            />
          ) : (
            <ul className="card divide-y divide-line">
              {orgList.map((org) => (
                <li key={org.id} className="interactive-row flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <Link
                      href={`/crm/${org.id}`}
                      className="text-[14px] font-medium hover:text-brand-fg"
                    >
                      {org.name}
                    </Link>
                    {org.website ? (
                      <p className="meta truncate">{org.website}</p>
                    ) : null}
                  </div>
                  <Badge tone="neutral">{categoryLabel(org.category, t)}</Badge>
                  {org.owner ? (
                    <span
                      className="flex items-center gap-1.5 text-[12.5px] text-muted"
                      title={t("crm.ownerTitle", { name: org.owner.full_name })}
                    >
                      <Avatar name={org.owner.full_name} src={org.owner.avatar_url} size="sm" />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-8">
          <DecisionsExpected pipeline={pipeline} today={today} />

          <section aria-labelledby="crm-followups">
          <h2 id="crm-followups" className="section-heading mb-3">
            {t("crm.followUpQueue")}
          </h2>
          {followUpList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("crm.followUpQueueEmpty")}
            </p>
          ) : (
            <>
              <FollowUpGroup
                title={t("crm.overdue")}
                items={followUpList.filter((item) => item.due_at < today)}
                format={format}
              />
              <FollowUpGroup
                title={t("crm.upcoming")}
                items={followUpList.filter((item) => item.due_at >= today)}
                format={format}
              />
            </>
          )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function FollowUpGroup({
  title,
  items,
  format,
}: {
  title: string;
  items: CrmFollowUp[];
  format: Formatters;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-[12.5px] font-semibold">{title}</h3>
      <ul className="card divide-y divide-line">
        {items.map((followUp) => (
          <li key={followUp.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium">{followUp.title}</p>
              <p className="meta">
                {followUp.crm_organization?.name} · {format.date(followUp.due_at)}
              </p>
            </div>
            <FollowUpTaskButton followUpId={followUp.id} taskId={followUp.task_id} />
            <CompleteFollowUpButton followUpId={followUp.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
