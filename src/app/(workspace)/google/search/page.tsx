import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Input, Label } from "@/components/ui/input";
import { requireGoogleObjects } from "@/features/google-objects/gate";
import { fill, googleObjectsText } from "@/features/google-objects/messages";
import { searchConnectedApps } from "@/features/google-objects/search/connected-search.server";
import { cleanTerm, type SourceOutcome } from "@/features/google-objects/search/google-search";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: googleObjectsText(await getLocale()).search.title };
}
export const dynamic = "force-dynamic";

export default async function ConnectedSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireGoogleObjects();
  const session = await requireSession();
  const text = googleObjectsText(await getLocale()).search;
  const format = await getFormatters();
  const { q } = await searchParams;
  const term = cleanTerm(q);
  // The service client only reads this person's own tokens: every lookup in
  // searchConnectedApps is pinned to session.userId.
  const outcomes: SourceOutcome[] = term
    ? await searchConnectedApps({
        service: createSupabaseServiceClient(),
        userId: session.userId,
        organizationId: session.organizationId,
        term,
      })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title={text.title} description={text.description} />
      <form role="search" method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Label htmlFor="connected-search">{text.label}</Label>
          <Input id="connected-search" name="q" type="search" defaultValue={q ?? ""} maxLength={100} minLength={2} required />
        </div>
        <button
          type="submit"
          className="inline-flex h-9.5 items-center rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
        >
          {text.submit}
        </button>
      </form>
      {q && !term ? <p className="meta">{text.tooShort}</p> : null}
      {outcomes.map((outcome) => {
        const service = outcome.source === "drive" ? text.drive : text.gmail;
        const results = outcome.status === "ok" ? outcome.results : [];
        return (
          <section key={outcome.source} aria-labelledby={`results-${outcome.source}`} className="space-y-2">
            <h2 id={`results-${outcome.source}`} className="text-[15px] font-semibold">
              {service}
            </h2>
            {outcome.status === "not_connected" ? (
              <p className="meta">{fill(text.notConnected, { service })}</p>
            ) : outcome.status === "unavailable" ? (
              <p role="alert" className="text-sm text-danger-fg">
                {fill(text.unavailable, { service })}
              </p>
            ) : results.length === 0 ? (
              <p className="meta">{fill(text.none, { service })}</p>
            ) : (
              <ul className="space-y-2">
                {results.map((result) => {
                  const title = result.title || text.noSubject;
                  return (
                    <li key={result.id} className="card p-3">
                      <a
                        href={result.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-brand-fg hover:underline"
                        aria-label={fill(text.opensInGoogle, { name: title })}
                      >
                        {title}
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                      <p className="meta">
                        {[result.detail, result.when ? format.inZone(result.when, session.timeZone, { dateStyle: "medium" }) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
