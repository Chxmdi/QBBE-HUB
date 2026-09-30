import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { QueryBlock } from "@/features/lenses/query-block";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("block.embedTitle") };
}
export const dynamic = "force-dynamic";

/**
 * A query block on its own (M8e), for previewing a lens as a page will show
 * it and for the browser tests. `?lens=<id>` or `?type=task`, plus `view`,
 * `rows` and `title`. The props go to the block unchecked, so bad ones show
 * the block's own "not valid" state, as they would inside a page.
 */
export default async function QueryBlockPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  const session = await requireSession();
  const t = await getLensT();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const lens = one(params.lens);
  const type = one(params.type) ?? "task";
  const rows = Number.parseInt(one(params.rows) ?? "", 10);
  const props = {
    source: lens ? { lensId: lens } : { spec: { version: 1 as const, type, select: ["status", "priority", "due"] } },
    view: (one(params.view) ?? "table") as "table",
    ...(Number.isFinite(rows) ? { maxRows: rows } : {}),
    ...(one(params.title) ? { title: one(params.title) } : {}),
  };
  return (
    <div>
      <PageHeader title={t("block.embedTitle")} description={t("block.embedDescription")} />
      <QueryBlock {...props} timeZone={session.timeZone} />
    </div>
  );
}
