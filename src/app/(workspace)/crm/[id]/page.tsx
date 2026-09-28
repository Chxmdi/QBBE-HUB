import type { Metadata } from "next";
import { CommentThread } from "@/features/comments/components/comment-thread";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  createCrmAgreement,
  createCrmContact,
  createCrmLink,
  createFollowUp,
  recordInteraction,
} from "@/features/crm/services/crm.commands";
import { ArchiveOrganizationButton } from "@/features/crm/components/archive-organization-button";
import { CrmOrganizationDialog } from "@/features/crm/components/crm-organization-dialog";
import { FollowUpTaskButton } from "@/features/crm/components/follow-up-task-button";
import { DeepLinkScroll } from "@/components/shared/deep-link-scroll";
import { OpportunityPipeline } from "@/features/crm/components/opportunity-pipeline";
import { getOpportunitiesForCrmOrganization } from "@/features/crm/services/opportunity.queries";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { calendarDateInZone } from "@/lib/time";
import { createSupabasePageClient } from "@/lib/supabase/page";
import {
  agreementStatusLabel,
  categoryLabel,
  followUpStatusLabel,
  interactionTypeLabel,
} from "@/features/crm/labels";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { CrmContact, CrmFollowUp, CrmInteraction } from "@/types/entities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.detailMetaTitle") };
}
export const dynamic = "force-dynamic";

export default async function CrmDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ opportunity?: string; contact?: string }>;
}) {
  const session = await requireSession();
  if (!session.isStaff) redirect("/");
  const { id } = await params;
  const { opportunity: highlightId = null, contact: highlightContact = null } = await searchParams;
  // The workspace's calendar date, not the server's: this drives both the
  // opportunity query below and the dated labels the page renders.
  const nowInstant = new Date();
  const today =
    calendarDateInZone(nowInstant, session.timeZone) ??
    nowInstant.toISOString().slice(0, 10);
  const supabase = await createSupabasePageClient();
  const [t, format] = await Promise.all([getT(), getFormatters()]);

  const { data: org } = await supabase
    .from("crm_organization")
    .select(
      "id, name, category, website, status, notes, next_action_at, owner_id, created_at, owner:owner_id(id, full_name, avatar_url)",
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
    { data: links },
    { data: events },
    { data: documents },
    { data: tasks },
    { data: agreements },
    sensitiveRes,
  ] = await Promise.all([
      supabase
        .from("crm_contact")
        .select("id, crm_organization_id, full_name, role_title, email, phone, owner_id, status, communication_notes")
        .eq("crm_organization_id", id)
        .order("full_name"),
      supabase
        .from("crm_interaction")
        .select(
          "id, crm_organization_id, contact_id, interaction_type, occurred_at, owner_id, summary, next_steps, document_id, document:document_id(id, title), owner:owner_id(id, full_name, email, avatar_url, title, timezone)",
        )
        .eq("crm_organization_id", id)
        .order("occurred_at", { ascending: false })
        .limit(30),
      supabase
        .from("crm_follow_up")
        .select("id, crm_organization_id, owner_id, title, due_at, status, task_id")
        .eq("crm_organization_id", id)
        .order("due_at"),
      getOpportunitiesForCrmOrganization(id, today),
      getPickerOptions(),
      supabase
        .from("program")
        .select("id, name")
        .eq("status", "active")
        .order("name"),
    supabase
      .from("crm_link")
      .select("id, program_id, project_id, event_id, task_id, contact_id, opportunity_id, agreement_id, program:program_id(name), project:project_id(name), event:event_id(name), task:task_id(title), opportunity:opportunity_id(title), agreement:agreement_id(title), contact:contact_id(full_name)")
      .eq("crm_organization_id", id),
    supabase.from("event").select("id, name").order("starts_at", { ascending: false }).limit(50),
    supabase.from("document").select("id, title").order("created_at", { ascending: false }).limit(50),
    supabase.from("task").select("id, title").is("archived_at", null).order("title").limit(50),
    supabase
      .from("crm_agreement")
      .select("id, title, status, starts_on, ends_on")
      .eq("crm_organization_id", id)
      .order("created_at", { ascending: false }),
    // Row-level security returns the note only to the owner or an administrator.
    supabase.from("crm_sensitive_note").select("notes").eq("crm_organization_id", id).maybeSingle(),
    ]);

  const owner = org.owner as unknown as { full_name: string; avatar_url: string | null } | null;
  const contactList = (contacts ?? []) as unknown as CrmContact[];
  const interactionList = (interactions ?? []) as unknown as CrmInteraction[];
  const followUpList = (followUps ?? []) as unknown as CrmFollowUp[];
  const programOptions = (programRows ?? []).map((p) => ({
    id: p.id as string,
    label: p.name as string,
  }));
  const sensitiveNotes = (sensitiveRes.data as { notes?: string | null } | null)?.notes ?? null;
  const canEditSensitive =
    session.isAdmin || (org as { owner_id?: string }).owner_id === session.userId;
  const linkRows = (links ?? []) as unknown as {
    id: string;
    contact_id?: string | null;
    program?: { name: string } | null;
    project?: { name: string } | null;
    event?: { name: string } | null;
    task?: { title: string } | null;
    opportunity?: { title: string } | null;
    agreement?: { title: string } | null;
    contact?: { full_name: string } | null;
  }[];
  const agreementList = (agreements ?? []) as {
    id: string;
    title: string;
    status: string;
    starts_on: string | null;
    ends_on: string | null;
  }[];

  return (
    <div>
      <Breadcrumbs
        items={[{ label: t("crm.title"), href: "/crm" }, { label: org.name as string }]}
      />
      <PageHeader
        eyebrow={categoryLabel(org.category as string, t)}
        title={org.name as string}
        description={
          [
            org.notes,
            org.next_action_at
              ? t("crm.nextAction", { date: format.date(org.next_action_at as string) })
              : null,
            sensitiveNotes ? t("crm.sensitive", { notes: sensitiveNotes }) : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CrmOrganizationDialog
              organization={{
                id: org.id as string,
                name: org.name as string,
                category: org.category as string,
                website: (org.website as string | null) ?? null,
                notes: (org.notes as string | null) ?? null,
                next_action_at: (org.next_action_at as string | null) ?? null,
                sensitive_notes: sensitiveNotes,
              }}
              canEditSensitive={canEditSensitive}
            />
            <ArchiveOrganizationButton
              organizationId={org.id as string}
              status={org.status as string}
            />
            {owner ? (
              <span className="flex items-center gap-2 text-[13.5px]">
                <Avatar name={owner.full_name} src={owner.avatar_url} size="md" />
                <span>
                  <span className="block font-medium">{owner.full_name}</span>
                  <span className="meta">{t("crm.relationshipOwner")}</span>
                </span>
              </span>
            ) : null}
          </div>
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
              {t("crm.interactions.heading")}
            </h2>
            <EntityFormDialog
              triggerLabel={t("crm.interactions.record")}
              triggerVariant="secondary"
              title={t("crm.interactions.record")}
              submitLabel={t("crm.interactions.submit")}
              action={recordInteraction}
              extraValues={{ crmOrganizationId: org.id as string }}
              fields={[
                {
                  name: "interactionType",
                  label: t("crm.fields.type"),
                  type: "select",
                  required: true,
                  colSpan: 1,
                  defaultValue: "note",
                  options: ["meeting", "call", "email", "message", "note", "other"].map(
                    (type) => ({ value: type, label: interactionTypeLabel(type, t) }),
                  ),
                },
                {
                  name: "contactId",
                  label: t("crm.fields.contact"),
                  type: "select",
                  colSpan: 1,
                  options: contactList.map((c) => ({ value: c.id, label: c.full_name })),
                },
                { name: "summary", label: t("crm.fields.summary"), type: "textarea", required: true },
                { name: "nextSteps", label: t("crm.fields.nextSteps"), type: "textarea" },
                {
                  name: "documentId",
                  label: t("crm.fields.document"),
                  type: "select",
                  options: ((documents ?? []) as { id: string; title: string }[]).map((doc) => ({
                    value: doc.id,
                    label: doc.title,
                  })),
                },
              ]}
            />
          </div>
          {interactionList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("crm.interactions.empty")}
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
                    <Badge tone="neutral">
                      {interactionTypeLabel(interaction.interaction_type, t)}
                    </Badge>
                    <span className="meta ml-auto">
                      {format.relative(interaction.occurred_at)}
                    </span>
                  </div>
                  <p className="text-[13.5px] whitespace-pre-wrap">
                    {interaction.summary}
                  </p>
                  {interaction.next_steps ? (
                    <p className="mt-1.5 text-[13px]">
                      <span className="font-medium">{t("crm.interactions.next")}</span>{" "}
                      {interaction.next_steps}
                    </p>
                  ) : null}
                  {interaction.document?.title ? (
                    <p className="mt-1.5 text-[13px]">
                      <Link
                        href="/documents"
                        className="font-medium text-brand-fg hover:underline"
                      >
                        {interaction.document.title}
                      </Link>
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
                {t("crm.contacts.heading")}
              </h2>
              <EntityFormDialog
                triggerLabel={t("crm.add")}
                triggerVariant="secondary"
                title={t("crm.contacts.addTitle")}
                submitLabel={t("crm.contacts.submit")}
                action={createCrmContact}
                extraValues={{ crmOrganizationId: org.id as string }}
                fields={[
                  { name: "fullName", label: t("crm.fields.name"), type: "text", required: true },
                  { name: "roleTitle", label: t("crm.fields.role"), type: "text", colSpan: 1 },
                  { name: "email", label: t("crm.fields.email"), type: "email", colSpan: 1 },
                  { name: "phone", label: t("crm.fields.phone"), type: "text", colSpan: 1 },
                  { name: "communicationNotes", label: t("crm.fields.communicationNotes"), type: "textarea" },
                ]}
              />
            </div>
            {contactList.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                {t("crm.contacts.empty")}
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {contactList.map((contact) => (
                  <li
                    key={contact.id}
                    id={`contact-${contact.id}`}
                    className={contact.id === highlightContact ? "bg-accent/15 px-4 py-2.5" : "px-4 py-2.5"}
                  >
                    <p className="text-[13.5px] font-medium">{contact.full_name}</p>
                    <p className="meta">
                      {[contact.role_title, contact.email, contact.phone]
                        .filter(Boolean)
                        .join(" · ") || t("crm.contacts.noDetails")}
                    </p>
                    {contact.communication_notes ? (
                      <p className="meta">{contact.communication_notes}</p>
                    ) : null}
                    {linkRows
                      .filter((link) => link.contact_id === contact.id)
                      .map((link) => (
                        <p key={link.id} className="meta">
                          {t("crm.contacts.linked")}{" "}
                          {link.program?.name ??
                            link.project?.name ??
                            link.event?.name ??
                            link.task?.title ??
                            link.opportunity?.title ??
                            link.agreement?.title ??
                            t("crm.contacts.linkedFallback")}
                        </p>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="followups-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="followups-heading" className="section-heading">
                {t("crm.followUps.heading")}
              </h2>
              <EntityFormDialog
                triggerLabel={t("crm.add")}
                triggerVariant="secondary"
                title={t("crm.followUps.scheduleTitle")}
                submitLabel={t("crm.followUps.schedule")}
                action={createFollowUp}
                extraValues={{ crmOrganizationId: org.id as string }}
                fields={[
                  { name: "title", label: t("crm.fields.followUp"), type: "text", required: true },
                  { name: "dueAt", label: t("crm.fields.dueDate"), type: "date", required: true },
                ]}
              />
            </div>
            {followUpList.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                {t("crm.followUps.empty")}
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {followUpList.map((followUp) => (
                  <li key={followUp.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 text-[13.5px]">
                      {followUp.title}
                    </span>
                    <span className="meta whitespace-nowrap">
                      {format.date(followUp.due_at)}
                    </span>
                    <FollowUpTaskButton followUpId={followUp.id} taskId={followUp.task_id} />
                    <Badge tone={followUp.status === "done" ? "success" : "warning"}>
                      {followUpStatusLabel(followUp.status, t)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="agreements-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="agreements-heading" className="section-heading">
                {t("crm.agreements.heading")}
              </h2>
              <EntityFormDialog
                triggerLabel={t("crm.add")}
                triggerVariant="secondary"
                title={t("crm.agreements.addTitle")}
                submitLabel={t("crm.save")}
                action={createCrmAgreement}
                extraValues={{ crmOrganizationId: org.id as string }}
                fields={[
                  { name: "title", label: t("crm.fields.title"), type: "text", required: true },
                  {
                    name: "status",
                    label: t("crm.fields.status"),
                    type: "select",
                    defaultValue: "draft",
                    options: [
                      { value: "draft", label: t("crm.agreements.statusOptions.draft") },
                      { value: "active", label: t("crm.agreements.statusOptions.active") },
                      { value: "ended", label: t("crm.agreements.statusOptions.ended") },
                    ],
                  },
                  { name: "startsOn", label: t("crm.fields.starts"), type: "date", colSpan: 1 },
                  { name: "endsOn", label: t("crm.fields.ends"), type: "date", colSpan: 1 },
                  {
                    name: "contactId",
                    label: t("crm.fields.contact"),
                    type: "select",
                    options: contactList.map((contact) => ({
                      value: contact.id,
                      label: contact.full_name,
                    })),
                  },
                  { name: "notes", label: t("crm.fields.notes"), type: "textarea" },
                ]}
              />
            </div>
            {agreementList.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                {t("crm.agreements.empty")}
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {agreementList.map((agreement) => (
                  <li key={agreement.id} className="px-4 py-2.5">
                    <p className="text-[13.5px] font-medium">{agreement.title}</p>
                    <p className="meta">
                      {agreementStatusLabel(agreement.status, t)}
                      {agreement.starts_on ? ` · ${format.date(agreement.starts_on)}` : ""}
                      {agreement.ends_on ? ` → ${format.date(agreement.ends_on)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="links-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="links-heading" className="section-heading">
                {t("crm.links.heading")}
              </h2>
              <EntityFormDialog
                triggerLabel={t("crm.links.trigger")}
                triggerVariant="secondary"
                title={t("crm.links.title")}
                submitLabel={t("crm.links.submit")}
                action={createCrmLink}
                extraValues={{ crmOrganizationId: org.id as string }}
                fields={[
                  {
                    name: "contactId",
                    label: t("crm.fields.contact"),
                    type: "select",
                    options: contactList.map((contact) => ({ value: contact.id, label: contact.full_name })),
                  },
                  {
                    name: "programId",
                    label: t("crm.fields.program"),
                    type: "select",
                    options: programOptions.map((program) => ({ value: program.id, label: program.label })),
                  },
                  {
                    name: "projectId",
                    label: t("crm.fields.project"),
                    type: "select",
                    options: options.projects.map((project) => ({ value: project.id, label: project.label })),
                  },
                  {
                    name: "eventId",
                    label: t("crm.fields.event"),
                    type: "select",
                    options: ((events ?? []) as { id: string; name: string }[]).map((event) => ({
                      value: event.id,
                      label: event.name,
                    })),
                  },
                  {
                    name: "taskId",
                    label: t("crm.fields.task"),
                    type: "select",
                    options: ((tasks ?? []) as { id: string; title: string }[]).map((task) => ({
                      value: task.id,
                      label: task.title,
                    })),
                  },
                  {
                    name: "opportunityId",
                    label: t("crm.fields.grant"),
                    type: "select",
                    options: [...pipeline.open, ...pipeline.settled].map((item) => ({
                      value: item.id,
                      label: item.title,
                    })),
                  },
                  {
                    name: "agreementId",
                    label: t("crm.fields.agreement"),
                    type: "select",
                    options: agreementList.map((agreement) => ({
                      value: agreement.id,
                      label: agreement.title,
                    })),
                  },
                ]}
              />
            </div>
            {linkRows.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                {t("crm.links.empty")}
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {linkRows.map((link) => (
                  <li key={link.id} className="px-4 py-2.5 text-[13.5px]">
                    {[
                      link.program?.name,
                      link.project?.name,
                      link.event?.name,
                      link.task?.title,
                      link.opportunity?.title,
                      link.agreement?.title,
                      link.contact?.full_name,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("crm.links.fallback")}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      <DeepLinkScroll targetId={highlightContact ? `contact-${highlightContact}` : null} />
      <CommentThread parentType="organization" parentId={id} />
    </div>
  );
}
