import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRef, ProjectRef } from "../suggest";

export interface CaptureItem {
  id: string;
  kind: "text" | "link" | "file" | "photo" | "email";
  title: string;
  body: string | null;
  url: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  email_from: string | null;
  email_subject: string | null;
  created_at: string;
}

export const CAPTURE_COLUMNS =
  "id, kind, title, body, url, storage_path, file_name, mime_type, size_bytes, email_from, email_subject, created_at";

type Db = Pick<SupabaseClient, "from">;

/**
 * The viewer's open inbox, and the projects and contacts suggestions can name,
 * all through the viewer's own client: an item is only ever matched against
 * records its owner can already see.
 */
export async function loadCaptureInbox(db: Db): Promise<{
  items: CaptureItem[];
  projects: ProjectRef[];
  contacts: ContactRef[];
}> {
  const [items, projects, contacts] = await Promise.all([
    db
      .from("capture_item")
      .select(CAPTURE_COLUMNS)
      .eq("status", "inbox")
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("project")
      .select("id, name")
      .is("archived_at", null)
      .is("completed_at", null)
      .order("name")
      .limit(300),
    db
      .from("crm_contact")
      .select("id, full_name, email, crm_organization_id, organization:crm_organization_id(name)")
      .not("email", "is", null)
      .limit(1000),
  ]);
  type ContactRow = Omit<ContactRef, "organization_name"> & { organization: { name: string } | null };
  return {
    items: (items.data ?? []) as unknown as CaptureItem[],
    projects: (projects.data ?? []) as ProjectRef[],
    contacts: ((contacts.data ?? []) as unknown as ContactRow[]).map(({ organization, ...contact }) => ({
      ...contact,
      organization_name: organization?.name ?? null,
    })),
  };
}
