"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label, Textarea, Checkbox } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  closeProject,
  getUnresolvedWork,
  type UnresolvedWork,
} from "@/features/projects/services/project.commands";
import { useT } from "@/lib/i18n/client";

/**
 * Closure flow that surfaces unresolved work before confirmation
 * (§10.5 acceptance, P0-PRJ-08).
 */
export function CloseProjectDialog({
  projectId,
  projectName,
  documents = [],
}: {
  projectId: string;
  projectName: string;
  /** Documents already filed against this project, offerable as evidence. */
  documents?: { id: string; title: string }[];
}) {
  const router = useRouter();
  const t = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [unresolved, setUnresolved] = useState<UnresolvedWork | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(true);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setUnresolved(null);
    const work = await getUnresolvedWork(projectId);
    setUnresolved(work);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await closeProject({
      projectId,
      results: form.get("results"),
      lessons: (form.get("lessons") as string) || undefined,
      evidenceLinks: (form.get("evidenceLinks") as string) || undefined,
      evidenceDocumentIds: evidenceIds,
      archiveOpenTasks: archiveOpen,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("projects.close.error"));
      return;
    }
    toast(t("projects.close.toast", { name: projectName }));
    setOpen(false);
    router.refresh();
  }

  const hasOpenWork =
    unresolved !== null &&
    (unresolved.openTasks > 0 ||
      unresolved.openMilestones > 0 ||
      unresolved.openRisks > 0 ||
      unresolved.openIssues > 0);

  return (
    <>
      <Button variant="secondary" onClick={openDialog}>
        {t("projects.close.open")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("projects.close.title", { name: projectName })}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Unresolved work, surfaced before the decision */}
          {unresolved === null ? (
            <p className="text-[13.5px] text-muted">{t("projects.close.checking")}</p>
          ) : hasOpenWork ? (
            <div className="rounded-(--radius-sm) border border-warning/30 bg-warning/10 p-3">
              <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-warning-fg">
                <AlertTriangle className="size-4" aria-hidden />
                {t("projects.close.openWork")}
              </p>
              <ul className="mt-1.5 space-y-0.5 text-[13px]">
                {unresolved.openTasks > 0 ? (
                  <li>
                    {t(
                      unresolved.openTasks === 1
                        ? "projects.close.openTasksOne"
                        : "projects.close.openTasksOther",
                      { count: unresolved.openTasks },
                    )}
                    {unresolved.blockedTasks > 0
                      ? t("projects.close.blocked", { count: unresolved.blockedTasks })
                      : ""}
                  </li>
                ) : null}
                {unresolved.openMilestones > 0 ? (
                  <li>
                    {t(
                      unresolved.openMilestones === 1
                        ? "projects.close.openMilestonesOne"
                        : "projects.close.openMilestonesOther",
                      { count: unresolved.openMilestones },
                    )}
                  </li>
                ) : null}
                {unresolved.openRisks > 0 ? (
                  <li>
                    {t(
                      unresolved.openRisks === 1
                        ? "projects.close.openRisksOne"
                        : "projects.close.openRisksOther",
                      { count: unresolved.openRisks },
                    )}
                  </li>
                ) : null}
                {unresolved.openIssues > 0 ? (
                  <li>
                    {t(
                      unresolved.openIssues === 1
                        ? "projects.close.openIssuesOne"
                        : "projects.close.openIssuesOther",
                      { count: unresolved.openIssues },
                    )}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 rounded-(--radius-sm) bg-success/10 px-3 py-2 text-[13.5px] text-success-fg">
              <CheckCircle2 className="size-4" aria-hidden />
              {t("projects.close.clear")}
            </p>
          )}

          <div>
            <Label htmlFor="close-results">{t("projects.close.results")}</Label>
            <Textarea
              id="close-results"
              name="results"
              required
              rows={3}
              maxLength={5000}
              placeholder={t("projects.close.resultsPlaceholder")}
            />
          </div>
          <div>
            <Label htmlFor="close-lessons">
              {t("projects.close.lessons")}{" "}
              <span className="font-normal text-muted">{t("projects.close.optional")}</span>
            </Label>
            <Textarea id="close-lessons" name="lessons" rows={2} maxLength={5000} />
          </div>

          <div>
            <Label htmlFor="close-evidence-links">
              {t("projects.close.evidenceLinks")}{" "}
              <span className="font-normal text-muted">{t("projects.close.optional")}</span>
            </Label>
            <Textarea
              id="close-evidence-links"
              name="evidenceLinks"
              rows={2}
              maxLength={4000}
              placeholder={t("projects.close.evidencePlaceholder")}
            />
            <p className="mt-1 text-[12.5px] text-muted">
              {t("projects.close.evidenceHintBefore")} <code>{t("projects.close.evidenceHintFormat")}</code>
              {t("projects.close.evidenceHintAfter")}
            </p>
          </div>

          {documents.length > 0 ? (
            <fieldset>
              <legend className="mb-1 text-[13.5px] font-medium">
                {t("projects.close.attachDocuments")}
              </legend>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-(--radius-sm) border border-line p-2">
                {documents.map((document) => (
                  <li key={document.id}>
                    <label className="flex items-start gap-2 text-[13px]">
                      <Checkbox className="mt-0.5"
                        checked={evidenceIds.includes(document.id)}
                        onChange={(e) =>
                          setEvidenceIds((current) =>
                            e.target.checked
                              ? [...current, document.id]
                              : current.filter((id) => id !== document.id),
                          )
                        }
                      />
                      <span>{document.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {hasOpenWork ? (
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <Checkbox
                checked={archiveOpen}
                onChange={(e) => setArchiveOpen(e.target.checked)} className="mt-0.5"
              />
              <span>
                {t(
                  unresolved?.openTasks === 1
                    ? "projects.close.archiveOne"
                    : "projects.close.archiveOther",
                  { count: unresolved?.openTasks ?? 0 },
                )}
                <span className="block text-muted">
                  {t("projects.close.archiveHint")}
                </span>
              </span>
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("projects.close.cancel")}
            </Button>
            <Button type="submit" loading={saving} disabled={unresolved === null}>
              {t("projects.close.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
