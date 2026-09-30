import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { OfflineWorkspace, type OfflineTask } from "@/features/offline/components/offline-workspace";
import { offlineText } from "@/features/offline/messages";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: offlineText(await getLocale()).title };
}
export const dynamic = "force-dynamic";

export default async function OfflinePage() {
  if (!(await isEnabled("wos_offline"))) notFound();
  const session = await requireSession();
  const text = offlineText(await getLocale());
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("task")
    .select("id, title, status, priority")
    .or(`assignee_id.eq.${session.userId},requester_id.eq.${session.userId}`)
    .not("status", "in", "(completed,cancelled)")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={text.eyebrow} title={text.title} description={text.description} />
      <OfflineWorkspace userId={session.userId} tasks={(data ?? []) as OfflineTask[]} text={text} />
    </div>
  );
}
