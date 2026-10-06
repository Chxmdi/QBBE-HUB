"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  createDocumentLink,
  registerUploadedDocument,
  saveDocumentText,
} from "@/features/documents/services/document.commands";
import { useFileTextReader } from "@/features/documents/text-extract/use-file-text-reader";
import { TextReadingStatus } from "@/features/documents/text-extract/text-reading-status";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Option } from "@/features/tasks/components/task-create-dialog";
import {
  folderLabel,
  groupFolders,
  type LibraryFolder,
} from "@/features/documents/services/library";
import { useT } from "@/lib/i18n/client";

const MAX_BYTES = 25 * 1024 * 1024;

/** Upload a file to private storage, or register an external link. */
export function DocumentUploadDialog({
  projects,
  programs,
  approvedHosts = [],
  folders = [],
  defaultFolderId = "",
}: {
  projects: Option[];
  programs: Option[];
  /** Library folders the person can see (#147). */
  folders?: LibraryFolder[];
  defaultFolderId?: string;
  /**
   * What the library will accept, so the form can say so before somebody types
   * a link it is going to refuse. The list is the organization's own, read
   * server-side; the database is what actually enforces it.
   */
  approvedHosts?: { host: string; label: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("file");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // The words in the chosen file are read on this device while the form is
  // filled in, so search can find the file by them (#147).
  const reader = useFileTextReader();

  function close() {
    reader.reset();
    setOpen(false);
  }

  function contextFields(form: FormData) {
    return {
      projectId: (form.get("projectId") as string) || undefined,
      programId: (form.get("programId") as string) || undefined,
      visibility: (form.get("visibility") as string) || "organization",
      description: (form.get("description") as string) || undefined,
      folderId: (form.get("folderId") as string) || undefined,
      tags: (form.get("tags") as string) || undefined,
    };
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file") as File | null;
    if (!file || file.size === 0) {
      setError(t("documents.upload.chooseFile"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("documents.upload.tooLarge"));
      return;
    }

    setSaving(true);
    setProgress(t("documents.upload.uploading"));
    const supabase = createSupabaseBrowserClient();
    // Random prefix avoids collisions; the path is never the authorization.
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `${crypto.randomUUID()}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type || undefined });

    if (uploadError) {
      setSaving(false);
      setProgress(null);
      setError(t("documents.upload.uploadFailed"));
      return;
    }

    setProgress(t("documents.upload.savingRecord"));
    const result = await registerUploadedDocument({
      title: (form.get("title") as string) || file.name,
      storagePath: path,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
      ...contextFields(form),
    });
    setSaving(false);
    setProgress(null);

    if (!result.ok) {
      // Registration can fail after Storage accepted the bytes. The matching
      // policy permits owners to remove only their own unregistered uploads.
      await supabase.storage.from("documents").remove([path]);
      setError(result.error ?? t("documents.upload.saveRecordFailed"));
      return;
    }
    await storeText(result.id);
    toast(t("documents.upload.uploaded"));
    close();
    router.refresh();
  }

  /** Saves the file's words once its record exists. Never fails the upload. */
  async function storeText(documentId: string | undefined) {
    if (!documentId) return;
    setSaving(true);
    setProgress(t("documents.upload.readingWords"));
    const found = await reader.result();
    if (found) await saveDocumentText({ id: documentId, ...found });
    setSaving(false);
    setProgress(null);
  }

  async function handleLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await createDocumentLink({
      title: form.get("title"),
      url: form.get("url"),
      ...contextFields(form),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("documents.upload.saveResourceFailed"));
      return;
    }
    toast(t("documents.upload.resourceAdded"));
    close();
    router.refresh();
  }

  const contextInputs = (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="doc-project">{t("documents.upload.project")}</Label>
          <Select id="doc-project" name="projectId" defaultValue="">
            <option value="">{t("documents.upload.noProject")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="doc-program">{t("documents.upload.program")}</Label>
          <Select id="doc-program" name="programId" defaultValue="">
            <option value="">{t("documents.upload.noProgram")}</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="doc-folder">{t("documents.upload.folder")}</Label>
          <Select id="doc-folder" name="folderId" defaultValue={defaultFolderId}>
            <option value="">{t("documents.upload.noFolder")}</option>
            {groupFolders(folders, t).map((group) => (
              <optgroup key={group.category} label={group.label}>
                {group.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderLabel(f, t)}
                    {f.visibility === "staff" ? t("documents.staffOnlySuffix") : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="doc-tags">
            {t("documents.upload.tags")}{" "}
            <span className="font-normal text-muted">{t("documents.upload.optional")}</span>
          </Label>
          <Input id="doc-tags" name="tags" maxLength={500} placeholder={t("documents.upload.tagsPlaceholder")} />
        </div>
      </div>
      <FieldHint>{t("documents.upload.folderHint")}</FieldHint>
      <div>
        <Label htmlFor="doc-visibility">{t("documents.upload.visibility")}</Label>
        <Select id="doc-visibility" name="visibility" defaultValue="organization">
          <option value="organization">{t("documents.upload.allActive")}</option>
          <option value="staff">{t("documents.upload.staffAndAdmins")}</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="doc-description">
          {t("documents.upload.description")}{" "}
          <span className="font-normal text-muted">{t("documents.upload.optional")}</span>
        </Label>
        <Textarea id="doc-description" name="description" maxLength={2000} rows={2} />
      </div>
    </>
  );

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {t("documents.upload.trigger")}
      </Button>
      <Dialog open={open} onClose={close} title={t("documents.upload.title")}>
        <Tabs
          tabs={[
            { id: "file", label: t("documents.upload.tabFile") },
            { id: "link", label: t("documents.upload.tabLink") },
          ]}
          active={tab}
          onChange={setTab}
        />

        <TabPanel id="file" active={tab}>
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <Label htmlFor="doc-file">{t("documents.upload.file")}</Label>
              <Input
                id="doc-file"
                name="file"
                type="file"
                required
                onChange={(e) => reader.read(e.target.files?.[0])}
              />
              <FieldHint>{t("documents.upload.fileHint")}</FieldHint>
              <TextReadingStatus state={reader.state} onSkip={reader.skip} />
            </div>
            <div>
              <Label htmlFor="doc-file-title">{t("documents.upload.fileTitle")}</Label>
              <Input
                id="doc-file-title"
                name="title"
                maxLength={200}
                placeholder={t("documents.upload.fileTitlePlaceholder")}
              />
            </div>
            {contextInputs}
            {error ? (
              <p role="alert" className="text-[13px] text-danger-fg">
                {error}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2 pt-1">
              {progress ? <span className="meta">{progress}</span> : null}
              <Button type="button" variant="secondary" onClick={close}>
                {t("documents.upload.cancel")}
              </Button>
              <Button type="submit" loading={saving}>
                <Upload className="size-4" aria-hidden />
                {t("documents.upload.submit")}
              </Button>
            </div>
          </form>
        </TabPanel>

        <TabPanel id="link" active={tab}>
          <form onSubmit={handleLink} className="space-y-4">
            <div>
              <Label htmlFor="doc-link-title">{t("documents.upload.linkTitle")}</Label>
              <Input id="doc-link-title" name="title" required maxLength={200} />
            </div>
            <div>
              <Label htmlFor="doc-url">{t("documents.upload.url")}</Label>
              <Input
                id="doc-url"
                name="url"
                type="url"
                required
                placeholder={t("documents.upload.urlPlaceholder")}
              />
              <FieldHint>
                {approvedHosts.length
                  ? t("documents.upload.approvedHosts", {
                      hosts: approvedHosts.map((h) => h.label || h.host).join(", "),
                    })
                  : t("documents.upload.noApprovedHosts")}
              </FieldHint>
            </div>
            {contextInputs}
            {error ? (
              <p role="alert" className="text-[13px] text-danger-fg">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={close}>
                {t("documents.upload.cancel")}
              </Button>
              <Button type="submit" loading={saving}>
                {t("documents.upload.trigger")}
              </Button>
            </div>
          </form>
        </TabPanel>
      </Dialog>
    </>
  );
}
