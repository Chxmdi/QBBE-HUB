import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Label } from "@/components/ui/input";
import { ReviewButtons } from "@/features/upkeep/components/review-buttons";
import { requireUpkeep } from "@/features/upkeep/gate";
import { fill, upkeepText, type UpkeepText } from "@/features/upkeep/messages";
import {
  STALE_THRESHOLDS,
  hrefFor,
  kindOf,
  staleThreshold,
  total,
  type DuplicateRow,
  type IssueRow,
  type StaleRow,
} from "@/features/upkeep/report";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: upkeepText(await getLocale()).title };
}
export const dynamic = "force-dynamic";

function IssueList({ rows, text }: { rows: IssueRow[]; text: UpkeepText }) {
  if (rows.length === 0) return <p className="meta">{text.nothing}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const href = hrefFor(row.object_type, row.object_id);
        const issue = text.issues[row.issue as keyof UpkeepText["issues"]] ?? row.issue;
        return (
          <li key={`${row.issue}-${row.object_id}`} className="card p-3">
            <span className="meta mr-2">{text.kinds[kindOf(row)]}</span>
            {href ? (
              <Link href={href} className="font-medium text-brand-fg hover:underline" aria-label={fill(text.open, { title: row.title })}>
                {row.title}
              </Link>
            ) : (
              <span className="font-medium">{row.title}</span>
            )}
            <p className="meta">{fill(issue, { detail: row.detail ?? "" })}</p>
          </li>
        );
      })}
    </ul>
  );
}

export default async function UpkeepPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireUpkeep();
  await requireSession();
  const text = upkeepText(await getLocale());
  const days = staleThreshold((await searchParams).days);
  const supabase = await createSupabasePageClient();
  // Every report runs as the viewer, so it lists only what they can open.
  const [stale, broken, orphans, duplicates, unused] = await Promise.all([
    supabase.rpc("upkeep_stale_pages", { p_days: days }),
    supabase.rpc("upkeep_broken_links"),
    supabase.rpc("upkeep_orphans", { p_days: 30 }),
    supabase.rpc("upkeep_duplicates"),
    supabase.rpc("upkeep_unused"),
  ]);
  const staleRows = (stale.data ?? []) as StaleRow[];
  const brokenRows = (broken.data ?? []) as IssueRow[];
  const orphanRows = ((orphans.data ?? []) as (IssueRow & { detail: string })[]).map((r) => ({ ...r, issue: r.detail, detail: null }));
  const duplicateRows = (duplicates.data ?? []) as DuplicateRow[];
  const unusedRows = (unused.data ?? []) as IssueRow[];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.title}
        description={text.description}
        actions={<p className="meta">{fill(text.summary, { count: total([staleRows, brokenRows, orphanRows, duplicateRows, unusedRows]) })}</p>}
      />

      <section aria-labelledby="upkeep-stale" className="space-y-3">
        <h2 id="upkeep-stale" className="text-[15px] font-semibold">
          {text.staleHeading}
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="upkeep-days">{text.thresholdLabel}</Label>
            <select
              id="upkeep-days"
              name="days"
              defaultValue={String(days)}
              className="h-9.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-sm text-ink"
            >
              {STALE_THRESHOLDS.map((d) => (
                <option key={d} value={d}>
                  {fill(text.days, { days: d })}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="h-9.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-sm text-ink hover:bg-surface-soft">
            {text.show}
          </button>
        </form>
        <p className="meta">{fill(text.staleHelp, { days })}</p>
        {staleRows.length === 0 ? (
          <p className="meta">{text.nothing}</p>
        ) : (
          <ul className="space-y-2">
            {staleRows.map((row) => (
              <li key={row.object_id} className="card space-y-2 p-3">
                <div>
                  <span className="meta mr-2">{text.kinds[row.object_type]}</span>
                  <span className="font-medium">{row.title}</span>
                  <p className="meta">
                    {fill(text.idleFor, { days: row.days_idle })} · {row.owner_name ? fill(text.owner, { name: row.owner_name }) : text.noOwner}
                  </p>
                </div>
                <ReviewButtons objectType={row.object_type} objectId={row.object_id} title={row.title} text={text} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="upkeep-broken" className="space-y-3">
        <h2 id="upkeep-broken" className="text-[15px] font-semibold">
          {text.brokenHeading}
        </h2>
        <IssueList rows={brokenRows} text={text} />
      </section>

      <section aria-labelledby="upkeep-orphans" className="space-y-3">
        <h2 id="upkeep-orphans" className="text-[15px] font-semibold">
          {text.orphansHeading}
        </h2>
        <IssueList rows={orphanRows} text={text} />
      </section>

      <section aria-labelledby="upkeep-duplicates" className="space-y-3">
        <h2 id="upkeep-duplicates" className="text-[15px] font-semibold">
          {text.duplicatesHeading}
        </h2>
        {duplicateRows.length === 0 ? (
          <p className="meta">{text.nothing}</p>
        ) : (
          <ul className="space-y-2">
            {duplicateRows.map((row) => (
              <li key={`${row.object_type}-${row.object_ids[0]}`} className="card p-3">
                <span className="meta mr-2">{text.kinds[row.object_type]}</span>
                {fill(text.sameAs, { count: row.object_ids.length, titles: row.titles.map((t) => `“${t}”`).join(", ") })}
                <ul className="mt-1 flex flex-wrap gap-3">
                  {row.object_ids.map((id, index) => {
                    const href = hrefFor(row.object_type, id);
                    return href ? (
                      <li key={id}>
                        <Link href={href} className="text-sm text-brand-fg underline">
                          {fill(text.open, { title: `${row.titles[index]} (${index + 1})` })}
                        </Link>
                      </li>
                    ) : null;
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="upkeep-unused" className="space-y-3">
        <h2 id="upkeep-unused" className="text-[15px] font-semibold">
          {text.unusedHeading}
        </h2>
        <p className="meta">{text.unusedHelp}</p>
        <IssueList rows={unusedRows} text={text} />
      </section>
    </div>
  );
}
