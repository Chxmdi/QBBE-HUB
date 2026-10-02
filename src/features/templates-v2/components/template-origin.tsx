import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TEMPLATES_FLAG } from "@/features/templates-v2/gate";
import { fill, templatesV2Text } from "@/features/templates-v2/messages";

/**
 * Under a page's title: the template and version the page was made from
 * (T1), with links to the template and the hub's project when the reader can
 * open them. Nothing with the switches off or for a page made by hand.
 */
export async function TemplateOrigin({ pageId }: { pageId: string }) {
  if (!(await isEnabled("wos_pages")) || !(await isEnabled(TEMPLATES_FLAG))) return null;
  const supabase = await createSupabaseServerClient();
  const { data: origin } = await supabase
    .from("page_template_origin")
    .select("template_id, template_version, template_name_en, template_name_fr, project_id")
    .eq("page_id", pageId)
    .maybeSingle();
  if (!origin) return null;
  const text = templatesV2Text(await getLocale());
  const fr = (await getLocale()) === "fr-CA";
  const [{ data: template }, { data: project }] = await Promise.all([
    origin.template_id
      ? supabase.from("template_v2").select("id").eq("id", origin.template_id).maybeSingle()
      : Promise.resolve({ data: null }),
    origin.project_id
      ? supabase.from("project").select("id").eq("id", origin.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted" data-testid="template-origin">
      <span className="inline-flex items-center gap-1.5">
        <LayoutTemplate className="size-3.5" aria-hidden />
        {fill(text.origin.madeFrom, {
          name: (fr ? origin.template_name_fr : origin.template_name_en) as string,
          n: origin.template_version as number,
        })}
      </span>
      {template ? (
        <Link href={`/templates-v2/${template.id}`} className="text-brand-fg underline">
          {text.origin.openTemplate}
        </Link>
      ) : null}
      {project ? (
        <Link href={`/projects/${project.id}`} className="text-brand-fg underline">
          {text.origin.openProject}
        </Link>
      ) : null}
    </p>
  );
}
