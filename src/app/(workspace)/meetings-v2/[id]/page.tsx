import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { taskStatusLabel } from "@/components/shared/status-badges";
import { meetingsV2Enabled } from "@/features/meetings-v2/flag";
import { meetingsV2T } from "@/features/meetings-v2/i18n";
import { semanticBlockKinds } from "@/features/meetings-v2/editor-adapter";
import { getMeetingObject } from "@/features/meetings-v2/services/meeting-v2.queries";
import { MeetingNotes } from "@/features/meetings-v2/components/meeting-notes";
import { CaptureForm } from "@/features/meetings-v2/components/capture-form";
import { RecordingUpload } from "@/features/meetings-v2/components/recording-upload";
import { ObjectEditor } from "@/features/editor/components/object-editor";
import { loadEditorDocument } from "@/features/editor/services/editor-document.queries";
import { plainTextToContent } from "@/features/editor/adapter/content";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: meetingsV2T(await getLocale())("title") };
}

const STATUS_TONE = { open: "warning", approved: "success", dismissed: "neutral" } as const;

export default async function MeetingObjectPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await meetingsV2Enabled())) notFound();
  const session = await requireSession();
  const { id } = await params;
  const [locale, format, editorOn] = await Promise.all([getLocale(), getFormatters(), isEnabled("wos_editor")]);
  const t = meetingsV2T(locale);
  const app = createTranslator(locale);
  const view = await getMeetingObject(id);
  if (!view) notFound();
  const { meeting, agenda, captures, recordings, people, canManage } = view;
  const openCount = captures.filter((c) => c.status === "open").length;
  // The notes are the block editor when its switch is on (F1): the same
  // editor, autosave and semantic blocks as a page. Notes typed before that,
  // or while the switch was off, open as one paragraph per line.
  const body = editorOn ? await loadEditorDocument(await createSupabasePageClient(), meeting.id) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t("title")}
        title={meeting.title}
        description={meeting.purpose ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/meetings/${meeting.id}`} className="inline-flex h-9.5 items-center rounded-(--radius-sm) border border-line bg-surface px-4 text-sm text-ink hover:bg-surface-soft">
              {t("classicView")}
            </Link>
            <Link href={`/meetings-v2/${meeting.id}/review`} className="inline-flex h-9.5 items-center rounded-(--radius-sm) bg-brand px-4 text-sm text-white hover:bg-brand-strong">
              {t("startReview")}
              {openCount > 0 ? <span className="ml-2 rounded-full bg-surface px-2 text-[12px] text-ink">{openCount}</span> : null}
            </Link>
          </div>
        }
      />

      <dl className="mb-6 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">{t("when")}</dt>
          <dd className="text-ink">{format.dateTime(meeting.startsAt)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("organizer")}</dt>
          <dd className="text-ink">{meeting.organizer?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="sr-only">{t("title")}</dt>
          <dd><Badge tone="brand">{t(`status.${meeting.status}`)}</Badge></dd>
        </div>
      </dl>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="mv2-agenda">
            <h2 id="mv2-agenda" className="section-heading mb-3">{t("agenda.heading")}</h2>
            {agenda.length === 0 ? (
              <p className="text-sm text-muted">{t("agenda.empty")}</p>
            ) : (
              <ol className="card divide-y divide-line">
                {agenda.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span className="text-ink">{item.title}</span>
                    <span className="text-[12.5px] text-muted">
                      {[item.owner, item.timeBoxMinutes ? t("agenda.minutes", { minutes: item.timeBoxMinutes }) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="mv2-notes">
            <h2 id="mv2-notes" className="section-heading mb-3">{t("notes.heading")}</h2>
            {body ? (
              <div className="card p-4">
                {canManage ? <p className="mb-3 text-[12.5px] text-muted">{t("notes.blockHint")}</p> : null}
                <ObjectEditor
                  key={meeting.id}
                  objectId={meeting.id}
                  objectType="meeting"
                  initialContent={body.version === null ? plainTextToContent(meeting.notes) : body.content}
                  initialState={body.state}
                  initialVersion={body.version}
                  editable={canManage}
                  label={t("notes.label")}
                  timeZone={session.timeZone}
                  defaultProjectId={meeting.projectId}
                />
                {!canManage ? <p className="mt-3 text-[12.5px] text-muted">{t("notes.readOnly")}</p> : null}
              </div>
            ) : (
              <MeetingNotes meetingId={meeting.id} initialContent={meeting.notes ?? ""} readOnly={!canManage} />
            )}
          </section>

          <section aria-labelledby="mv2-captures">
            <h2 id="mv2-captures" className="section-heading mb-3">{t("capture.heading")}</h2>
            <CaptureForm
              meetingId={meeting.id}
              people={people}
              agenda={agenda.map((a) => ({ id: a.id, title: a.title }))}
            />
            {captures.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t("capture.empty")}</p>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {semanticBlockKinds.map((kind) => {
                  const group = captures.filter((c) => c.kind === kind);
                  if (group.length === 0) return null;
                  return (
                    <div key={kind}>
                      <h3 className="mb-2 text-sm font-semibold text-ink">{t(`groups.${kind}`)}</h3>
                      <ul className="space-y-2">
                        {group.map((c) => (
                          <li key={c.id} className="card p-3 text-sm">
                            <p className="text-ink">{c.body}</p>
                            <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                              <Badge tone={STATUS_TONE[c.status]}>{t(`captureStatus.${c.status}`)}</Badge>
                              {/* An approved task capture shows its task as it is now (F3), not the copy it took. */}
                              {c.task ? <Badge>{taskStatusLabel(c.task.status, app)}</Badge> : null}
                              {(c.task ? c.task.assigneeName : c.ownerName) ? <span>{c.task ? c.task.assigneeName : c.ownerName}</span> : null}
                              {(c.task ? c.task.dueOn : c.dueOn) ? <span>{format.date(c.task ? c.task.dueOn : c.dueOn)}</span> : null}
                              {c.authorName ? <span>{t("capture.by", { name: c.authorName })}</span> : null}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside aria-labelledby="mv2-recording" className="space-y-3">
          <h2 id="mv2-recording" className="section-heading">{t("recording.heading")}</h2>
          {recordings.length === 0 ? (
            <p className="text-sm text-muted">{t("recording.empty")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recordings.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink">{r.title}</span>
                  <Link href={`/documents/${r.id}`} className="text-brand-fg underline">{t("recording.open")}</Link>
                </li>
              ))}
            </ul>
          )}
          {canManage ? <RecordingUpload meetingId={meeting.id} /> : null}
        </aside>
      </div>
    </div>
  );
}
