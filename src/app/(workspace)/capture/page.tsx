import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { filingChoices } from "@/features/capture/choices";
import { CaptureForm } from "@/features/capture/components/capture-form";
import { FileButtons } from "@/features/capture/components/file-buttons";
import { captureT } from "@/features/capture/i18n";
import { loadCaptureInbox } from "@/features/capture/services/capture.queries";
import { suggestFiling } from "@/features/capture/suggest";

export async function generateMetadata(): Promise<Metadata> {
  return { title: captureT(await getLocale())("page.title") };
}
export const dynamic = "force-dynamic";

/** The capture inbox (M18): quick capture, rule-based suggestions, one tap to file. */
export default async function CapturePage() {
  const session = await requireSession();
  if (!(await isEnabled("wos_capture"))) notFound();
  const t = captureT(await getLocale());
  const format = await getFormatters();
  const db = await createSupabasePageClient();
  const { items, projects, contacts } = await loadCaptureInbox(db);

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <CaptureForm />
      <section aria-labelledby="capture-inbox" className="mt-6">
        <h2 id="capture-inbox" className="flex items-baseline justify-between text-[15px] font-semibold text-ink">
          <span>{t("inbox.title")}</span>
          {items.length ? <span className="text-xs font-normal text-muted">{t(items.length === 1 ? "inbox.countOne" : "inbox.count", { count: items.length })}</span> : null}
        </h2>
        {items.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("inbox.empty")}</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {items.map((item) => {
              const suggestions = suggestFiling(item, { projects, contacts });
              return (
                <li key={item.id} className="rounded-(--radius-md) border border-line bg-surface p-3">
                  <p className="text-xs text-muted">
                    {t(`form.kind.${item.kind}`)} · {format.dateTime(item.created_at, session.timeZone)}
                    {item.email_from ? ` · ${t("inbox.from", { from: item.email_from })}` : ""}
                  </p>
                  <h3 className="text-sm font-medium text-ink">{item.title}</h3>
                  {item.url ? (
                    <a href={item.url} rel="noreferrer noopener" target="_blank" className="text-xs break-all text-brand-fg underline hover:no-underline">
                      {item.url}
                    </a>
                  ) : null}
                  {item.body && item.body !== item.title ? (
                    <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-muted">{item.body}</p>
                  ) : null}
                  <FileButtons itemId={item.id} title={item.title} choices={filingChoices(item.kind, suggestions, t)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
