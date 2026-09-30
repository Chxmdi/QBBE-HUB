import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { fill } from "@/features/collab/i18n";
import { layoutsText } from "@/features/object-layouts/messages";
import { listObjectTypes } from "@/features/object-layouts/services/layout.queries";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: layoutsText(await getLocale()).list.title };
}

/** Every object type and whether its page layout is customized (V2-4). */
export default async function LayoutsPage() {
  if (!(await isEnabled("wos_editor"))) notFound();
  await requireSession();
  const locale = await getLocale();
  const m = layoutsText(locale).list;
  const types = await listObjectTypes();
  const db = await createSupabasePageClient();
  const { data } = await db.from("object_layout").select("type_id");
  const customized = new Set(((data ?? []) as { type_id: string }[]).map((row) => row.type_id));
  const name = (type: (typeof types)[number]) => (locale === "fr-CA" ? type.name.fr : type.name.en);

  return (
    <>
      <PageHeader title={m.title} description={m.description} />
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <caption className="sr-only">{m.title}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-2 font-medium">{m.type}</th>
              <th scope="col" className="px-4 py-2 font-medium">{m.status}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {types.map((type) => (
              <tr key={type.id}>
                <th scope="row" className="px-4 py-2 font-medium">
                  <a
                    href={`/collab/layouts/${type.key}`}
                    aria-label={fill(m.edit, { type: name(type) })}
                    className="text-brand-fg hover:underline"
                  >
                    {name(type)}
                  </a>
                </th>
                <td className="px-4 py-2">{customized.has(type.id) ? m.custom : m.standard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
