import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { contentAdapterFor } from "@/features/versions/adapters/registry";
import { isContentSnapshot, type ObjectSnapshot } from "@/features/versions/content";
import { diffSnapshots } from "@/features/versions/diff";
import { versionsText } from "@/features/versions/messages";
import { objectTypeKeySchema } from "@/features/versions/schema";
import {
  getObjectVersion,
  listObjectVersions,
  type VersionSummary,
} from "@/features/versions/services/version.queries";
import { VersionCompare } from "@/features/versions/components/version-compare";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: versionsText(await getLocale()).compare.title };
}

/**
 * Two versions of one object side by side, with restore (Workspace OS M16b).
 * `from` is a version id; `to` is a version id or `current`. The older of
 * the two is shown on the left and is the one restore brings back.
 */
export default async function CompareVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ objectId: string }>;
  searchParams: Promise<{ type?: string; from?: string; to?: string }>;
}) {
  if (!(await isEnabled("wos_editor"))) notFound();
  await requireSession();
  const query = await searchParams;
  const id = z.string().uuid().safeParse((await params).objectId);
  const type = objectTypeKeySchema.safeParse(query.type ?? "");
  if (!id.success || !type.success) notFound();

  const t = versionsText(await getLocale());
  const m = t.compare;
  const format = await getFormatters();
  const object = { id: id.data, type: type.data };
  const adapter = contentAdapterFor(object.type);
  const current = adapter ? await adapter.read(object) : null;
  if (!adapter || !current) {
    return (
      <>
        <PageHeader title={m.title} />
        <p className="meta">{adapter ? t.errors.notFound : t.errors.unsupported}</p>
      </>
    );
  }

  const versions = await listObjectVersions(object);
  const describe = (version: VersionSummary) =>
    `${version.label ?? t.history.kinds[version.kind]} · ${format.dateTime(version.createdAt)}`;

  async function load(ref: string | undefined): Promise<{ snapshot: ObjectSnapshot; label: string; version: VersionSummary | null; at: string } | null> {
    if (!ref || ref === "current") {
      return { snapshot: current!, label: m.current, version: null, at: new Date().toISOString() };
    }
    if (!z.string().uuid().safeParse(ref).success) return null;
    const detail = await getObjectVersion(ref);
    if (!detail || detail.objectId !== object.id || !isContentSnapshot(detail.content)) return null;
    return {
      snapshot: { content: detail.content, properties: detail.properties },
      label: describe(detail),
      version: detail,
      at: detail.createdAt,
    };
  }

  const [from, to] = await Promise.all([load(query.from ?? versions[0]?.id), load(query.to ?? "current")]);
  const db = await createSupabasePageClient();
  const { data: canEdit } = await db.rpc("can_object_content", {
    p_object: object.id,
    p_type: object.type,
    p_capability: "edit_content",
  });
  const [older, newer] = from && to && from.at > to.at ? [to, from] : [from, to];
  const base = `/collab/versions/${object.id}`;

  return (
    <>
      <PageHeader title={m.title} description={m.description} />
      <p className="mb-4">
        <a href={`${base}?type=${object.type}`} className="text-[13px] font-medium text-brand-fg hover:underline">
          {m.back}
        </a>
      </p>
      <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4" aria-label={m.pick}>
        <input type="hidden" name="type" value={object.type} />
        <div>
          <label htmlFor="compare-from" className="text-[13px] font-medium">{m.older}</label>
          <Select
            id="compare-from"
            name="from"
            defaultValue={older?.version?.id ?? "current"}
            className="block min-w-64"
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>{describe(version)}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="compare-to" className="text-[13px] font-medium">{m.newer}</label>
          <Select
            id="compare-to"
            name="to"
            defaultValue={newer?.version?.id ?? "current"}
            className="block min-w-64"
          >
            <option value="current">{m.current}</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>{describe(version)}</option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">{m.show}</Button>
      </form>
      {older && newer ? (
        <VersionCompare
          diff={diffSnapshots(older.snapshot, newer.snapshot)}
          restoreVersionId={older.version?.id ?? null}
          canRestore={canEdit === true}
          olderLabel={`${m.older}: ${older.label}`}
          newerLabel={`${m.newer}: ${newer.label}`}
        />
      ) : (
        <p className="meta">{versions.length === 0 ? t.history.none : t.errors.notFound}</p>
      )}
    </>
  );
}
