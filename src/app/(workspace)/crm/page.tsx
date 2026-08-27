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
import { CrmOrganizationDialog } from "@/features/crm/components/crm-organization-dialog";
import { createCrmContact, createFollowUp } from "@/features/crm/services/crm.commands";
import {
  DecisionsExpected,
  PipelineTotals,
} from "@/features/crm/components/pipeline-summary";
import { getPipeline } from "@/features/crm/services/opportunity.queries";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import type { CrmFollowUp, CrmOrganization } from "@/types/entities";

export const metadata: Metadata = { title: "Relationships" };
export const dynamic = "force-dynamic";

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const session = await requireSession();
  if (!session.isStaff) redirect("/");
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

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
        "id, crm_organization_id, owner_id, title, due_at, status, crm_organization:crm_organization_id(id, name)",
      )
      .eq("status", "open")
      .order("due_at")
      .limit(20),
    getPipeline(new Date().toISOString().slice(0, 10)),
  ]);

  const orgList = (organizations ?? []) as unknown as CrmOrganization[];
  const followUpList = (followUps ?? []) as unknown as CrmFollowUp[];
  const today = new Date().toISOString().slice(0, 10);
  const organizationOptions = orgList.map((organization) => ({
    value: organization.id,
    label: organization.name,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Relationship CRM"
        title="Relationships"
        description="Funders, schools, partners, and vendors — with one accountable owner and a next follow-up per relationship."
        actions={
          <div className="flex flex-wrap gap-2">
            <CrmOrganizationDialog defaultOpen={params.create === "organization"} />
            {organizationOptions.length > 0 ? <EntityFormDialog
              triggerLabel="New contact"
              triggerVariant="secondary"
              title="Add CRM contact"
              submitLabel="Add contact"
              defaultOpen={params.create === "contact"}
              action={createCrmContact}
              fields={[
                {
                  name: "crmOrganizationId",
                  label: "Organization",
                  type: "select",
                  required: true,
                  options: organizationOptions,
                },
                { name: "fullName", label: "Name", type: "text", required: true },
                { name: "roleTitle", label: "Role", type: "text" },
                { name: "email", label: "Email", type: "email" },
                { name: "phone", label: "Phone", type: "text" },
              ]}
            /> : null}
            {organizationOptions.length > 0 ? <EntityFormDialog
              triggerLabel="New follow-up"
              triggerVariant="secondary"
              title="Add CRM follow-up"
              submitLabel="Add follow-up"
              defaultOpen={params.create === "follow-up"}
              action={createFollowUp}
              fields={[
                {
                  name: "crmOrganizationId",
                  label: "Organization",
                  type: "select",
                  required: true,
                  options: organizationOptions,
                },
                { name: "title", label: "Follow-up", type: "text", required: true },
                { name: "dueAt", label: "Due date", type: "date", required: true },
              ]}
            /> : null}
          </div>
        }
      />

      {organizationOptions.length === 0 && ["contact", "follow-up"].includes(params.create ?? "") ? (
        <p role="status" className="mb-5 rounded-(--radius-sm) bg-surface-soft px-3 py-2 text-[13px] text-muted">
          Create an organization first, then add its contacts and follow-ups.
        </p>
      ) : null}

      <PipelineTotals pipeline={pipeline} />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <section aria-labelledby="crm-orgs">
          <h2 id="crm-orgs" className="section-heading mb-3">
            Organizations
          </h2>
          {orgList.length === 0 ? (
            <EmptyState
              icon={<Handshake />}
              title="No relationship records yet"
              description="Track funders, schools, universities, community partners, vendors, and government contacts."
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
                  <Badge tone="neutral">{org.category}</Badge>
                  {org.owner ? (
                    <span
                      className="flex items-center gap-1.5 text-[12.5px] text-muted"
                      title={`Owner: ${org.owner.full_name}`}
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
            Follow-up queue
          </h2>
          {followUpList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              Open follow-ups across all relationships appear here, soonest first.
            </p>
          ) : (
            <ul className="card divide-y divide-line">
              {followUpList.map((followUp) => (
                <li key={followUp.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">
                      {followUp.title}
                    </p>
                    <p className="meta">
                      {followUp.crm_organization?.name} ·{" "}
                      <span
                        className={
                          followUp.due_at < today ? "font-medium text-danger-fg" : ""
                        }
                      >
                        {followUp.due_at < today ? "Overdue · " : ""}
                        {formatDate(followUp.due_at)}
                      </span>
                    </p>
                  </div>
                  <CompleteFollowUpButton followUpId={followUp.id} />
                </li>
              ))}
            </ul>
          )}
          </section>
        </aside>
      </div>
    </div>
  );
}
