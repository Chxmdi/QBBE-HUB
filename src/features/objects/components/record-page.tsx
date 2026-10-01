import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import type { Locale } from "@/lib/i18n/config";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { ObjectEditor } from "@/features/editor/components/object-editor";
import { loadEditorDocument } from "@/features/editor/services/editor-document.queries";
import type { LayoutSection } from "@/features/object-layouts/layout";
import { labelFor, layoutsText } from "@/features/object-layouts/messages";
import { ObjectComments } from "@/features/object-comments/components/object-comments";
import { contentAdapterFor } from "@/features/versions/adapters/registry";
import { VersionHistory } from "@/features/versions/components/version-history";
import { listObjectVersions } from "@/features/versions/services/version.queries";
import { getObjectsT } from "../i18n/translate";
import type { ObjectsT } from "../i18n/translate";
import type { RecordPageData } from "../services/record-page.queries";
import { loadRelatedPanel } from "../services/related";
import { PropertiesSection } from "./properties-section";
import { RelatedPanel } from "./related-panel";
import { SectionBoundary } from "./section-boundary";

/**
 * Any object as a page (U14): its type's layout sections in order. Properties
 * are fields that write through object.set_property (so each change is a
 * change set that can be undone); Related is the M3b panel; Content is the
 * block editor where the type has one; Comments and Version history are the
 * M11 and M16 panels. Every value is read as the viewer, so nothing here
 * shows more than the database allows.
 */
export async function RecordPage({ data, session }: { data: RecordPageData; session: SessionContext }) {
  const { t, locale } = await getObjectsT();
  const lang = locale === "fr-CA" ? "fr" : "en";
  const { object, type, layout } = data;
  const typeLabel = (key: string) => {
    const found = data.types.find((candidate) => candidate.key === key);
    return found ? (lang === "fr" ? found.name.fr : found.name.en) : key;
  };
  const title = object.title.trim() || t("common.untitled");
  const heading = (section: LayoutSection) =>
    section.title?.[lang]?.trim() || t(`record.sections.${section.kind}`);

  const layoutText = layoutsText(locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={typeLabel(type.key)}
        title={title}
        actions={object.archivedAt ? <Badge tone="warning">{t("page.archived")}</Badge> : undefined}
      />
      {layout.sections.map((section) => {
        if (section.kind === "related") {
          const label =
            section.title?.[lang]?.trim() || labelFor(layoutText.relations as Record<string, string>, section.relation);
          const items = (data.taskPage?.related[section.relation] ?? []).slice(0, section.limit);
          return (
            <section key={section.id} aria-labelledby={`record-${section.id}`} data-testid={`record-section-${section.id}`}>
              <h2 id={`record-${section.id}`} className="section-heading mb-2">
                {label}
              </h2>
              {items.length === 0 ? (
                <p className="meta">{t("record.related.none")}</p>
              ) : (
                <ul className="card divide-y divide-line">
                  {items.map((item) => (
                    <li key={item.id} className="px-4 py-2 text-[13.5px]">
                      <Link href={`/objects/${item.id}`} className="text-brand-fg underline-offset-2 hover:underline">
                        {item.title.trim() || t("common.untitled")}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        }
        const label = heading(section);
        const fallback = <SectionLoading label={t("record.section.loading", { name: label })} />;
        const failed = (
          <p role="alert" className="meta">
            {t("record.section.error")}
          </p>
        );
        if (section.kind === "properties") {
          return (
            <section key={section.id} aria-labelledby={`record-${section.id}`} data-testid={`record-section-${section.id}`}>
              <h2 id={`record-${section.id}`} className="section-heading mb-2">
                {label}
              </h2>
              <SectionBoundary fallback={failed}>
                <PropertiesSection
                  objectId={object.id}
                  objectType={type.key}
                  keys={section.properties}
                  properties={data.properties}
                  people={data.people}
                  members={data.members}
                  canEdit={data.canEditFields}
                  archived={Boolean(object.archivedAt)}
                />
              </SectionBoundary>
            </section>
          );
        }
        if (section.kind === "content") {
          return (
            <section key={section.id} aria-labelledby={`record-${section.id}`} data-testid={`record-section-${section.id}`}>
              <h2 id={`record-${section.id}`} className="section-heading mb-2">
                {label}
              </h2>
              <SectionBoundary fallback={failed}>
                <Suspense fallback={fallback}>
                  <ContentSection data={data} session={session} title={title} t={t} />
                </Suspense>
              </SectionBoundary>
            </section>
          );
        }
        if (section.kind === "comments") {
          return (
            <div key={section.id} data-testid={`record-section-${section.id}`}>
              <SectionBoundary fallback={failed}>
                <Suspense fallback={fallback}>
                  <ObjectComments object={{ id: object.id, type: type.key }} />
                </Suspense>
              </SectionBoundary>
            </div>
          );
        }
        return (
          <div key={section.id} data-testid={`record-section-${section.id}`}>
            <SectionBoundary fallback={failed}>
              <Suspense fallback={fallback}>
                <VersionsSection data={data} label={label} t={t} />
              </Suspense>
            </SectionBoundary>
          </div>
        );
      })}
      <RelatedSection data={data} locale={locale} t={t} typeLabel={typeLabel} />
    </div>
  );
}

function SectionLoading({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <p role="status" className="sr-only">
        {label}
      </p>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

async function RelatedSection({
  data,
  locale,
  t,
  typeLabel,
}: {
  data: RecordPageData;
  locale: Locale;
  t: ObjectsT;
  typeLabel: (key: string) => string;
}) {
  let related: Awaited<ReturnType<typeof loadRelatedPanel>> | null = null;
  try {
    related = await loadRelatedPanel(data.object.id, data.object.organizationId, locale, t("common.untitled"));
  } catch {
    related = null;
  }
  if (!related) {
    return (
      <p role="alert" className="meta">
        {t("record.related.loadFailed")}
      </p>
    );
  }
  return <RelatedPanel data={related} typeLabel={typeLabel} typeName={typeLabel(data.type.key).toLowerCase()} t={t} />;
}

async function ContentSection({
  data,
  session,
  title,
  t,
}: {
  data: RecordPageData;
  session: SessionContext;
  title: string;
  t: ObjectsT;
}) {
  if (!data.editorType) return <p className="meta">{t("record.content.later")}</p>;
  if (!(await isEnabled("wos_editor"))) {
    const text = data.taskPage?.content?.trim();
    return text ? (
      <p className="card whitespace-pre-wrap p-4 text-[13.5px]">{text}</p>
    ) : (
      <p className="meta">{t("record.content.editorOff")}</p>
    );
  }
  const body = await loadEditorDocument(await createSupabasePageClient(), data.object.id);
  return (
    <ObjectEditor
      key={data.object.id}
      objectId={data.object.id}
      objectType={data.editorType}
      initialContent={body.content}
      initialState={body.state}
      initialVersion={body.version}
      timeZone={session.timeZone}
      editable={data.canEdit && !data.object.archivedAt}
      label={t("record.content.label", { title })}
    />
  );
}

async function VersionsSection({ data, label, t }: { data: RecordPageData; label: string; t: ObjectsT }) {
  const object = { id: data.object.id, type: data.type.key };
  if (!contentAdapterFor(object.type)) {
    return (
      <section aria-labelledby="record-versions-heading">
        <h2 id="record-versions-heading" className="section-heading mb-2">
          {label}
        </h2>
        <p className="meta">{t("record.versions.unsupported")}</p>
      </section>
    );
  }
  const versions = await listObjectVersions(object);
  return (
    <VersionHistory
      object={object}
      versions={versions}
      canEdit={data.canEdit && !data.object.archivedAt}
      compareBase={`/collab/versions/${object.id}/compare?type=${object.type}`}
    />
  );
}
