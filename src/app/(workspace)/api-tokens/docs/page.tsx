import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { apiTokenMessages } from "@/features/api-tokens/i18n";
import { apiDocs } from "@/features/api-tokens/i18n/docs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: apiTokenMessages(await getLocale()).docs.title };
}
export const dynamic = "force-dynamic";

/** The private API's documentation (V2-8). */
export default async function ApiDocsPage() {
  if (!(await isEnabled("wos_workflows_v2"))) notFound();
  await requireSession();
  const locale = await getLocale();
  const m = apiTokenMessages(locale);
  const docs = apiDocs(locale);
  const card = "rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5";
  return (
    <div className="max-w-4xl space-y-5">
      <p className="text-sm"><Link href="/api-tokens" className="text-brand-fg underline-offset-2 hover:underline">{m.title}</Link></p>
      <PageHeader eyebrow={m.eyebrow} title={m.docs.title} description={m.docs.intro} />
      {docs.sections.slice(0, 1).map((section) => (
        <section key={section.id} className={card} aria-labelledby={`docs-${section.id}`}>
          <h2 id={`docs-${section.id}`} className="section-heading mb-2">{section.heading}</h2>
          {section.paragraphs.map((text) => <p key={text} className="mb-2 text-sm text-ink">{text}</p>)}
          {section.code ? <pre className="overflow-x-auto rounded-(--radius-sm) bg-surface-soft p-3 text-[12.5px] text-ink">{section.code}</pre> : null}
        </section>
      ))}
      <section className={card} aria-labelledby="docs-endpoints">
        <h2 id="docs-endpoints" className="section-heading mb-2">{docs.endpointsHeading}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{docs.endpointsHeading}</caption>
            <thead className="text-[12.5px] text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">{docs.method}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{docs.path}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{docs.scope}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{docs.what}</th>
              </tr>
            </thead>
            <tbody>
              {docs.endpoints.map((endpoint) => (
                <tr key={`${endpoint.method} ${endpoint.path}`} className="border-t border-line align-top">
                  <td className="py-2 pr-3 font-mono text-[12.5px]">{endpoint.method}</td>
                  <td className="py-2 pr-3 font-mono text-[12.5px]">{endpoint.path}</td>
                  <td className="py-2 pr-3 font-mono text-[12.5px]">{endpoint.scope}</td>
                  <td className="py-2 pr-3">{endpoint.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {docs.sections.slice(1).map((section) => (
        <section key={section.id} className={card} aria-labelledby={`docs-${section.id}`}>
          <h2 id={`docs-${section.id}`} className="section-heading mb-2">{section.heading}</h2>
          {section.paragraphs.map((text) => <p key={text} className="mb-2 text-sm text-ink">{text}</p>)}
          {section.code ? <pre className="overflow-x-auto rounded-(--radius-sm) bg-surface-soft p-3 text-[12.5px] text-ink">{section.code}</pre> : null}
        </section>
      ))}
    </div>
  );
}
