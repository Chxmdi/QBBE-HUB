"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { usePagesT } from "@/features/pages/i18n/client";
import { checkImportFile, IMPORT_ACCEPT, type ImportFileProblem } from "@/features/pages/transfer/limits";

type Problem = ImportFileProblem | "noFile" | "unreadable" | "forbidden" | "failed";
const SERVER_PROBLEMS: readonly string[] = ["empty", "unsupported", "tooLarge", "unreadable", "forbidden"];

/**
 * Wave 2 unit X1: "Import" in the pages sidebar, next to "New page" in the
 * workspace and private areas. A dialog takes one Markdown or HTML file and
 * sends it to POST /api/pages/import, which makes it a new page in that area
 * and answers its id; the reader is then taken to it. The file's type and
 * size are checked here first so a wrong file is refused at once, and the
 * route checks both again. Only rendered where the reader may create pages
 * in that area, and the pages screens exist only with the wos_pages switch.
 */
export function X1PageImport({ visibility }: { visibility: "workspace" | "private" }) {
  const t = usePagesT();
  const router = useRouter();
  const id = React.useId();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string } | null>(null);
  const label = t(visibility === "workspace" ? "units.x1.import.workspaceLabel" : "units.x1.import.privateLabel");

  const say = (key: Problem) => setProblem({ text: t(`units.x1.import.errors.${key}`) });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const file = fileRef.current?.files?.[0];
    if (!file) return say("noFile");
    const local = checkImportFile(file);
    if (local) return say(local);
    setBusy(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.set("visibility", visibility);
      form.set("file", file);
      const response = await fetch("/api/pages/import", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string; message?: string } | null;
      if (response.ok && body?.id) {
        setOpen(false);
        router.push(`/pages/${body.id}`);
        router.refresh();
        return;
      }
      if (response.status === 429 && body?.message) setProblem({ text: body.message });
      else say(body?.error && SERVER_PROBLEMS.includes(body.error) ? (body.error as Problem) : "failed");
    } catch {
      say("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => {
          setProblem(null);
          setOpen(true);
        }}
        className="rounded-(--radius-sm) p-1 text-muted hover:bg-surface-soft hover:text-ink"
        data-page-import={visibility}
      >
        <Upload className="size-4" aria-hidden />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("units.x1.import.title")}>
        <form className="space-y-4 p-5" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
          <p className="text-sm text-muted">{t("units.x1.import.intro")}</p>
          <p className="text-sm text-muted">
            {t(visibility === "workspace" ? "units.x1.import.workspaceArea" : "units.x1.import.privateArea")}
          </p>
          <div>
            <Label htmlFor={`${id}-file`}>{t("units.x1.import.file")}</Label>
            <input
              ref={fileRef}
              id={`${id}-file`}
              name="file"
              type="file"
              accept={IMPORT_ACCEPT}
              aria-describedby={problem ? `${id}-problem` : undefined}
              aria-invalid={problem ? true : undefined}
              onChange={() => setProblem(null)}
              className="block w-full max-w-full text-sm text-ink file:mr-3 file:rounded-(--radius-sm) file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
            />
          </div>
          {problem ? (
            <p id={`${id}-problem`} role="alert" className="text-sm text-danger-fg">
              {problem.text}
            </p>
          ) : null}
          <p role="status" className="sr-only">
            {busy ? t("units.x1.import.working") : ""}
          </p>
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              {busy ? t("units.x1.import.working") : t("units.x1.import.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
