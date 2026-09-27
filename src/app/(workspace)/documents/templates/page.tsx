import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  GenerateDialog,
  TemplateArchiveButton,
  TemplateEditorDialog,
  type RecordOption,
  type TemplateRow,
} from "@/features/documents/components/template-panels";
import { folderLabel, type LibraryFolder } from "@/features/documents/services/library";
import {
  RECORD_TYPES,
  TEMPLATE_KINDS,
  TEMPLATE_LANGUAGES,
  type RecordType,
} from "@/features/documents/templates/merge";
import { requireStaff } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const metadata: Metadata = { title: "Document templates" };
export const dynamic = "force-dynamic";

const RECORD_LIMIT = 500;

/**
 * Templates for letters, contracts and acknowledgements (#147). Owners and
 * admins with MFA write them; staff generate a document from one and a record.
 * Every record list below is read with the person's own session, so it holds
 * only what they may read.
 */
export default async function DocumentTemplatesPage() {
  const session = await requireStaff();
  const supabase = await createSupabasePageClient();

  const [{ data: templateRows }, { data: folderRows }, { data: members }, { data: contacts }, { data: gifts }] =
    await Promise.all([
      supabase
        .from("document_template")
        .select("id, name, kind, language, record_type, body, folder_id")
        .eq("organization_id", session.organizationId)
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("document_folder")
        .select("id, category, name, visibility")
        .eq("organization_id", session.organizationId)
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("organization_membership")
        .select("user_id, profile:user_id(full_name, email)")
        .eq("organization_id", session.organizationId)
        .eq("status", "active")
        .limit(RECORD_LIMIT),
      supabase
        .from("crm_contact")
        .select("id, full_name")
        .eq("organization_id", session.organizationId)
        .order("full_name")
        .limit(RECORD_LIMIT),
      supabase
        .from("gift")
        .select("id, gift_number, received_on, contact:crm_contact_id(full_name), donor_org:crm_organization_id(name)")
        .eq("organization_id", session.organizationId)
        .eq("status", "recorded")
        .order("received_on", { ascending: false })
        .limit(RECORD_LIMIT),
    ]);

  const templates = (templateRows ?? []) as TemplateRow[];
  const folders = (folderRows ?? []) as LibraryFolder[];

  const records: Record<RecordType, RecordOption[]> = {
    member: ((members ?? []) as unknown as { user_id: string; profile: { full_name: string; email: string } | null }[])
      .map((m) => ({ id: m.user_id, label: m.profile?.full_name || m.profile?.email || "Member" }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    contact: ((contacts ?? []) as { id: string; full_name: string }[]).map((c) => ({
      id: c.id,
      label: c.full_name,
    })),
    gift: (
      (gifts ?? []) as unknown as {
        id: string;
        gift_number: number;
        received_on: string;
        contact: { full_name: string } | null;
        donor_org: { name: string } | null;
      }[]
    ).map((g) => ({
      id: g.id,
      label: `Gift ${g.gift_number} · ${g.contact?.full_name ?? g.donor_org?.name ?? ""} · ${g.received_on}`,
    })),
  };

  const folderName = (id: string | null) => {
    const folder = folders.find((f) => f.id === id);
    return folder ? folderLabel(folder) : null;
  };

  return (
    <div>
      <Link
        href="/documents"
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Documents
      </Link>
      <PageHeader
        eyebrow="Files & resources"
        title="Document templates"
        description="Letters, contracts and acknowledgements generated from records, in French or English. Each generated document is saved as a PDF in the library."
        actions={session.isAdmin ? <TemplateEditorDialog folders={folders} /> : null}
      />
      {session.isAdmin ? (
        <p className="meta mb-4">
          Creating or changing a template needs an owner or admin account with
          two-step verification (MFA) completed.
        </p>
      ) : null}

      {templates.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="No templates yet"
          description={
            session.isAdmin
              ? "Create a template for a thank-you letter, a contract or an acknowledgement."
              : "An owner or admin can create templates for letters, contracts and acknowledgements."
          }
        />
      ) : (
        <ul className="space-y-3" aria-label="Templates">
          {templates.map((template) => (
            <li key={template.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold">{template.name}</h2>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge>{TEMPLATE_KINDS.find((k) => k.id === template.kind)?.en}</Badge>
                    <Badge tone="info">
                      {TEMPLATE_LANGUAGES.find((l) => l.id === template.language)?.label}
                    </Badge>
                    <span className="meta">
                      Merges {RECORD_TYPES.find((r) => r.id === template.record_type)?.label.toLowerCase()}
                      {folderName(template.folder_id) ? ` · Files in ${folderName(template.folder_id)}` : ""}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <GenerateDialog
                    template={template}
                    records={records[template.record_type]}
                    folders={folders}
                  />
                  {session.isAdmin ? (
                    <>
                      <TemplateEditorDialog template={template} folders={folders} />
                      <TemplateArchiveButton template={template} />
                    </>
                  ) : null}
                </div>
              </div>
              <p className="meta mt-2 line-clamp-2 whitespace-pre-line">{template.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
