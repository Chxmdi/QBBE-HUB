import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  createCrmContact,
  createFollowUp,
  recordInteraction,
} from "@/features/crm/services/crm.commands";
import { DeepLinkScroll } from "@/components/shared/deep-link-scroll";
import { OpportunityPipeline } from "@/features/crm/components/opportunity-pipeline";
import { getOpportunitiesForCrmOrganization } from "@/features/crm/services/opportunity.queries";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, relativeTime } from "@/lib/utils";
import type { CrmContact, CrmFollowUp, CrmInteraction } from "@/types/entities";

export const metadata: Metadata = { title: "Relationship" };
export const dynamic = "force-dynamic";

export default async function CrmDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ opportunity?: string }>;
}) {
  const session = await requireSession();
  if (!session.isStaff) redirect("/");
  const { id } = await params;
  const { opportunity: highlightId = null } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createSupabaseServerClient();

  const { data: org } = await supabase
    .from("crm_organization")
    .select(
      "id, name, category, website, status, notes, created_at, owner:owner_id(id, full_name, avatar_url)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!org) notFound();

  const [
    { data: contacts },
    { data: interactions },
    { data: followUps },
    pipeline,
    options,
    { data: programRows },
  ] = await Promise.all([
      supabase
        .from("crm_contact")
        .select("id, crm_organization_id, full_name, role_title, email, phone, owner_id, status")
        .eq("crm_organization_id", id)
        .order("full_name"),
      supabase
        .from("crm_interaction")
        .select(
          "id, crm_organization_id, contact_id, interaction_type, occurred_at, owner_id, summary, next_steps, owner:owner_id(id, full_name, email, avatar_url, title, timezone)",
        )
        .eq("crm_organization_id", id)
        .order("occurred_at", { ascending: false })
        .limit(30),
      supabase
        .from("crm_follow_up")
        .select("id, crm_organization_id, owner_id, title, due_at, status")
        .eq("crm_organization_id", id)
        .order("due_at"),
      getOpportunitiesForCrmOrganization(id, today),
      getPickerOptions(),
      supabase
        .from("program")
        .select("id, name")
        .eq("status", "active")
        .order("name"),
    ]);

  const owner = org.owner as unknown as { full_name: string; avatar_url: string | null } | null;
  const contactList = (contacts ?? []) as unknown as CrmContact[];
  const interactionList = (interactions ?? []) as unknown as CrmInteraction[];
  const followUpList = (followUps ?? []) as unknown as CrmFollowUp[];
  const programOptions = (programRows ?? []).map((p) => ({
    id: p.id as string,
    label: p.name as string,
  }));

  return (
    <div>
      <div className="mb-2">
        <Link href="/crm" className="meta hover:text-brand-fg hover:underline">
          ← Relationships
        </Link>
      </div>
      <PageHeader
        eyebrow={org.category as string}
        title={org.name as string}
        description={org.notes ?? undefined}
        actions={
          owner ? (
            <span className="flex items-center gap-2 text-[13.5px]">
              <Avatar name={owner.full_name} src={owner.avatar_url} size="md" />
              <span>
                <span className="block font-medium">{owner.full_name}</span>
                <span className="meta">Relationship owner</span>
              </span>
            </span>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <div className="space-y-8">
        {/* Money first: it is the question a trustee asks about a funder. */}
        <OpportunityPipeline
          pipeline={pipeline}
          crmOrganizationId={org.id as string}
          people={options.people}
          programs={programOptions}
          projects={options.projects}
          contacts={contactList.map((c) => ({ id: c.id, label: c.full_name }))}
          today={today}
          highlightId={highlightId}
        />
        <DeepLinkScroll
          targetId={highlightId ? `opportunity-${highlightId}` : null}
        />

        <section aria-labelledby="interactions-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="interactions-heading" className="section-heading">
              Interaction history
            </h2>
            <EntityFormDialog
              triggerLabel="Record interaction"
              triggerVariant="secondary"
              title="Record interaction"
              submitLabel="Record"
              action={recordInteraction}
              extraValues={{ crmOrganizationId: org.id as string }}
              fields={[
                {
                  name: "interactionType",
                  label: "Type",
                  type: "select",
                  required: true,
                  colSpan: 1,
                  defaultValue: "note",
                  options: ["meeting", "call", "email", "message", "note", "other"].map(
                    (t) => ({ value: t, label: t }),
                  ),
                },
                {
                  name: "contactId",
                  label: "Contact",
                  type: "select",
                  colSpan: 1,
                  options: contactList.map((c) => ({ value: c.id, label: c.full_name })),
                },
                { name: "summary", label: "Summary", type: "textarea", required: true },
                { name: "nextSteps", label: "Next steps", type: "textarea" },
              ]}
            />
          </div>
          {interactionList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              Meetings, calls, emails, and notes recorded here preserve
              relationship continuity when ownership changes.
            </p>
          ) : (
            <ol className="space-y-3">
              {interactionList.map((interaction) => (
                <li key={interaction.id} className="card p-4">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    {interaction.owner ? (
                      <Avatar
                        name={interaction.owner.full_name}
                        src={interaction.owner.avatar_url}
                        size="sm"
                      />
                    ) : null}
                    <span className="text-[13px] font-medium">
                      {interaction.owner?.full_name}
                    </span>
                    <Badge tone="neutral">{interaction.interaction_type}</Badge>
                    <span className="meta ml-auto">
                      {relativeTime(interaction.occurred_at)}
                    </span>
                  </div>
                  <p className="text-[13.5px] whitespace-pre-wrap">
                    {interaction.summary}
                  </p>
                  {interaction.next_steps ? (
                    <p className="mt-1.5 text-[13px]">
                      <span className="font-medium">Next:</span>{" "}
                      {interaction.next_steps}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
        </div>

        <div className="space-y-8">
          <section aria-labelledby="contacts-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="contacts-heading" className="section-heading">
                Contacts
              </h2>
              <EntityFormDialog
                triggerLabel="Add"
                triggerVariant="secondary"
                title="Add contact"
                submitLabel="Add contact"
                action={createCrmContact}
                extraValues={{ crmOrganizationId: org.id as string }}
                fields={[
                  { name: "fullName", label: "Name", type: "text", required: true },
                  { name: "roleTitle", label: "Role", type: "text", colSpan: 1 },
                  { name: "email", label: "Email", type: "email", colSpan: 1 },
                  { name: "phone", label: "Phone", type: "text", colSpan: 1 },
                ]}
              />
            </div>
            {contactList.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No contacts recorded yet.
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {contactList.map((contact) => (
                  <li key={contact.id} className="px-4 py-2.5">
                    <p className="text-[13.5px] font-medium">{contact.full_name}</p>
                    <p className="meta">
                      {[contact.role_title, contact.email, contact.phone]
                        .filter(Boolean)
                        .join(" · ") || "No details"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="followups-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="followups-heading" className="section-heading">
                Follow-ups
              </h2>
              <EntityFormDialog
                triggerLabel="Add"
                triggerVariant="secondary"
                title="Schedule follow-up"
                submitLabel="Schedule"
                action={createFollowUp}
                extraValues={{ crmOrganizationId: org.id as string }}
                fields={[
                  { name: "title", label: "Follow-up", type: "text", required: true },
                  { name: "dueAt", label: "Due date", type: "date", required: true },
                ]}
              />
            </div>
            {followUpList.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                Every active relationship should have a next action date.
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {followUpList.map((followUp) => (
                  <li key={followUp.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 text-[13.5px]">
                      {followUp.title}
                    </span>
                    <span className="meta whitespace-nowrap">
                      {formatDate(followUp.due_at)}
                    </span>
                    <Badge tone={followUp.status === "done" ? "success" : "warning"}>
                      {followUp.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
