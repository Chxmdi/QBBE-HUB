import type { Metadata } from "next";
import Link from "next/link";
import { LayoutTemplate, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireTemplatesV2 } from "@/features/templates-v2/gate";
import { templatesV2Text } from "@/features/templates-v2/messages";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: templatesV2Text(await getLocale()).title };
}
export const dynamic = "force-dynamic";

const SCOPES = ["object", "page", "space"] as const;
type Scope = (typeof SCOPES)[number];

interface Row {
  id: string;
  scope: Scope;
  type_key: "task" | "project" | null;
  name_en: string;
  name_fr: string;
  description_en: string | null;
  description_fr: string | null;
  status: "draft" | "published";
}

export default async function TemplateGalleryPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  await requireTemplatesV2();
  const session = await requireSession();
  const locale = await getLocale();
  const text = templatesV2Text(locale);
  const fr = locale === "fr-CA";
  const { scope: raw } = await searchParams;
  const scope = (SCOPES as readonly string[]).includes(raw ?? "") ? (raw as Scope) : null;
  const supabase = await createSupabasePageClient();
  let query = supabase
    .from("template_v2")
    .select("id, scope, type_key, name_en, name_fr, description_en, description_fr, status")
    .order(fr ? "name_fr" : "name_en")
    .limit(500);
  if (scope) query = query.eq("scope", scope);
  const { data } = await query;
  const rows = (data ?? []) as Row[];
  const kind = (r: Row) => (r.scope === "object" ? text.kinds[r.type_key ?? "task"] : text.kinds[r.scope]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.title}
        description={text.description}
        actions={
          session.isStaff ? (
            <Link
              href="/templates-v2/new"
              className="inline-flex h-9.5 items-center gap-1.5 rounded-(--radius-sm) bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-strong"
            >
              <Plus className="size-4" aria-hidden />
              {text.newTemplate}
            </Link>
          ) : null
        }
      />
      <nav aria-label={text.filterLabel}>
        <ul className="flex flex-wrap gap-2">
          {[null, ...SCOPES].map((s) => (
            <li key={s ?? "all"}>
              <Link
                href={s ? `/templates-v2?scope=${s}` : "/templates-v2"}
                aria-current={scope === s ? "page" : undefined}
                className={`inline-flex h-8 items-center rounded-(--radius-sm) border px-3 text-[13px] ${
                  scope === s ? "border-brand bg-brand-soft text-brand-fg" : "border-line bg-surface text-ink hover:bg-surface-soft"
                }`}
              >
                {s ? text.scopes[s] : text.all}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={<LayoutTemplate />} title={text.empty} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id} className="card space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">{kind(r)}</Badge>
                {r.status === "draft" ? <Badge tone="neutral">{text.draft}</Badge> : null}
              </div>
              <Link href={`/templates-v2/${r.id}`} className="block font-medium text-brand-fg hover:underline">
                {fr ? r.name_fr : r.name_en}
              </Link>
              {(fr ? r.description_fr : r.description_en) ? (
                <p className="meta line-clamp-2">{fr ? r.description_fr : r.description_en}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
