import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { fill } from "@/features/collab/i18n";
import { layoutsText } from "@/features/object-layouts/messages";
import { layoutCatalog } from "@/features/object-layouts/services/layout.catalog";
import { listObjectTypes, loadLayout } from "@/features/object-layouts/services/layout.queries";
import { LayoutEditor } from "@/features/object-layouts/components/layout-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: layoutsText(await getLocale()).list.title };
}

/** Edit one type's page layout (V2-4); owners and admins only can save. */
export default async function LayoutEditorPage({ params }: { params: Promise<{ typeKey: string }> }) {
  if (!(await isEnabled("wos_editor"))) notFound();
  const session = await requireSession();
  const { typeKey } = await params;
  const type = (await listObjectTypes()).find((candidate) => candidate.key === typeKey);
  if (!type) notFound();

  const locale = await getLocale();
  const m = layoutsText(locale).editor;
  const typeName = locale === "fr-CA" ? type.name.fr : type.name.en;
  const catalog = await layoutCatalog(type.key);
  const { layout, saved } = await loadLayout(type.id, catalog);
  const db = await createSupabasePageClient();
  const { data: tasks } =
    type.key === "task"
      ? await db.from("task").select("id, title").order("updated_at", { ascending: false }).limit(20)
      : { data: [] };
  const previews = (tasks ?? []) as { id: string; title: string }[];

  return (
    <>
      <PageHeader
        title={fill(m.title, { type: typeName })}
        description={fill(m.description, { type: typeName.toLowerCase() })}
      />
      <LayoutEditor typeId={type.id} catalog={catalog} initial={layout} saved={saved} canEdit={session.isAdmin} />
      <section aria-labelledby="layout-preview" className="mt-8">
        <h2 id="layout-preview" className="section-heading mb-2">
          {fill(m.preview, { type: typeName.toLowerCase() })}
        </h2>
        {previews.length === 0 ? (
          <p className="meta">{fill(m.previewNone, { type: typeName.toLowerCase() })}</p>
        ) : (
          <form method="get" action={`/collab/layouts/${type.key}/preview`} className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="preview-object" className="text-[13px] font-medium">
                {fill(m.previewLabel, { type: typeName.toLowerCase() })}
              </label>
              <Select id="preview-object" name="object" defaultValue={previews[0].id}>
                {previews.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              {m.open}
            </Button>
          </form>
        )}
      </section>
    </>
  );
}
