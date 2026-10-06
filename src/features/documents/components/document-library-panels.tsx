"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Download, ExternalLink, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  getDocumentDownloadUrl,
  saveDocumentText,
} from "@/features/documents/services/document.commands";
import { useFileTextReader } from "@/features/documents/text-extract/use-file-text-reader";
import { TextReadingStatus } from "@/features/documents/text-extract/text-reading-status";
import {
  acknowledgeDocument,
  addDocumentVersion,
  updateDocumentDetails,
} from "@/features/documents/services/library.commands";
import {
  folderLabel,
  groupFolders,
  type LibraryFolder,
} from "@/features/documents/services/library";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useFormatters, useT } from "@/lib/i18n/client";
import type { TranslateFn } from "@/lib/i18n/translate";

const MAX_BYTES = 25 * 1024 * 1024;

export interface VersionRow {
  id: string;
  version_number: number;
  kind: "file" | "link";
  scan_status: "pending" | "clean" | "quarantined" | "rejected";
  size_bytes: number | null;
  created_at: string;
  superseded_at: string | null;
  archived_at: string | null;
  creator: { full_name: string } | null;
}

function scanLabel(v: VersionRow, t: TranslateFn): string | null {
  if (v.kind !== "file") return null;
  if (v.scan_status === "pending") return t("documents.list.scanPending");
  if (v.scan_status === "quarantined") return t("documents.list.quarantined");
  if (v.scan_status === "rejected") return t("documents.list.rejected");
  return null;
}

/** Every version of one document, newest first, each openable (#147). */
export function VersionHistory({
  versions,
  linkedId,
}: {
  versions: VersionRow[];
  linkedId: string;
}) {
  const { toast } = useToast();
  const t = useT();
  const format = useFormatters();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function open(version: VersionRow) {
    setBusyId(version.id);
    const result = await getDocumentDownloadUrl(version.id);
    setBusyId(null);
    if (!result.ok || !result.url) {
      toast(result.error ?? t("documents.versions.openFailed"), { tone: "error" });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <ol aria-label={t("documents.versions.history")} className="divide-y divide-line rounded-(--radius-md) border border-line">
      {versions.map((v) => {
        const current = v.superseded_at === null;
        const label = scanLabel(v, t);
        return (
          <li
            key={v.id}
            className={`flex flex-wrap items-center gap-3 px-4 py-3 ${v.id === linkedId && !current ? "bg-brand-soft/40" : ""}`}
          >
            <span className="font-medium">
              {t("documents.versions.version", { number: v.version_number })}
            </span>
            {current ? (
              <Badge tone="success">{t("documents.versions.current")}</Badge>
            ) : (
              <Badge>{t("documents.versions.earlier")}</Badge>
            )}
            {v.archived_at ? <Badge tone="warning">{t("documents.versions.archived")}</Badge> : null}
            {label ? (
              <Badge tone={v.scan_status === "pending" ? "warning" : "danger"}>{label}</Badge>
            ) : null}
            <span className="meta">
              {t("documents.versions.added", { date: format.date(v.created_at) })}
              {v.creator?.full_name
                ? t("documents.versions.byName", { name: v.creator.full_name })
                : ""}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => open(v)}
              loading={busyId === v.id}
              disabled={v.kind === "file" && v.scan_status !== "clean"}
              aria-label={t("documents.versions.openVersion", { number: v.version_number })}
            >
              {v.kind === "link" ? (
                <ExternalLink className="size-4" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              {t("documents.versions.open")}
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

/** Upload a replacement file, or point at a new link, as the next version. */
export function NewVersionDialog({
  currentId,
  currentKind,
}: {
  currentId: string;
  currentKind: "file" | "link";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>(currentKind);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Each version's words are read and stored for search (#147).
  const reader = useFileTextReader();

  function close() {
    reader.reset();
    setOpen(false);
  }

  async function handleFile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const file = new FormData(e.currentTarget).get("file") as File | null;
    if (!file || file.size === 0) {
      setError(t("documents.upload.chooseFile"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("documents.upload.tooLarge"));
      return;
    }
    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `${crypto.randomUUID()}/${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      setSaving(false);
      setError(t("documents.upload.uploadFailed"));
      return;
    }
    const result = await addDocumentVersion({
      kind: "file",
      supersedesId: currentId,
      storagePath: path,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    if (!result.ok) {
      setSaving(false);
      await supabase.storage.from("documents").remove([path]);
      setError(result.error ?? t("documents.versions.saveFailed"));
      return;
    }
    // The file's words, once the version exists. Never fails the upload.
    const found = result.id ? await reader.result() : null;
    if (found && result.id) await saveDocumentText({ id: result.id, ...found });
    setSaving(false);
    finish(result.id, t("documents.versions.uploadedToast"));
  }

  async function handleLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const result = await addDocumentVersion({
      kind: "link",
      supersedesId: currentId,
      url: new FormData(e.currentTarget).get("url"),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("documents.versions.saveFailed"));
      return;
    }
    finish(result.id, t("documents.versions.savedToast"));
  }

  function finish(id: string | undefined, message: string) {
    toast(message);
    close();
    router.push(`/documents/${id ?? currentId}`);
    router.refresh();
  }

  const footer = (label: string) => (
    <>
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
          {label}
        </Button>
      </div>
    </>
  );

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload className="size-4" aria-hidden />
        {t("documents.versions.newTrigger")}
      </Button>
      <Dialog open={open} onClose={close} title={t("documents.versions.newTitle")}>
        <p className="meta mb-3">{t("documents.versions.newIntro")}</p>
        <Tabs
          tabs={[
            { id: "file", label: t("documents.upload.tabFile") },
            { id: "link", label: t("documents.upload.tabLink") },
          ]}
          active={tab}
          onChange={setTab}
        />
        <TabPanel id="file" active={tab}>
          <form onSubmit={handleFile} className="space-y-4">
            <div>
              <Label htmlFor="version-file">{t("documents.upload.file")}</Label>
              <Input
                id="version-file"
                name="file"
                type="file"
                required
                onChange={(e) => reader.read(e.target.files?.[0])}
              />
              <FieldHint>{t("documents.versions.fileHint")}</FieldHint>
              <TextReadingStatus state={reader.state} onSkip={reader.skip} />
            </div>
            {footer(t("documents.versions.uploadVersion"))}
          </form>
        </TabPanel>
        <TabPanel id="link" active={tab}>
          <form onSubmit={handleLink} className="space-y-4">
            <div>
              <Label htmlFor="version-url">{t("documents.upload.url")}</Label>
              <Input id="version-url" name="url" type="url" required />
              <FieldHint>{t("documents.versions.linkHint")}</FieldHint>
            </div>
            {footer(t("documents.versions.saveVersion"))}
          </form>
        </TabPanel>
      </Dialog>
    </>
  );
}

/** Folder, tags and required reading for the current version. */
export function DocumentDetailsForm({
  documentId,
  folders,
  folderId,
  tags,
  requiresAcknowledgement,
  canRequireReading,
}: {
  documentId: string;
  folders: LibraryFolder[];
  folderId: string | null;
  tags: string[];
  requiresAcknowledgement: boolean;
  canRequireReading: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await updateDocumentDetails({
      documentId,
      folderId: (form.get("folderId") as string) || undefined,
      tags: (form.get("tags") as string) ?? "",
      requiresAcknowledgement: canRequireReading
        ? form.get("requiresAcknowledgement") === "on"
        : requiresAcknowledgement,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("documents.details.saveFailed"));
      return;
    }
    toast(t("documents.details.saved"));
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label={t("documents.details.aria")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="detail-folder">{t("documents.upload.folder")}</Label>
          <Select id="detail-folder" name="folderId" defaultValue={folderId ?? ""}>
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
          <Label htmlFor="detail-tags">{t("documents.upload.tags")}</Label>
          <Input
            id="detail-tags"
            name="tags"
            defaultValue={tags.join(", ")}
            maxLength={500}
            placeholder={t("documents.upload.tagsPlaceholder")}
          />
          <FieldHint>{t("documents.details.tagsHint")}</FieldHint>
        </div>
      </div>
      {canRequireReading ? (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            name="requiresAcknowledgement"
            defaultChecked={requiresAcknowledgement}
            className="mt-0.5"
          />
          <span>
            {t("documents.details.requiredReading")}
            <span className="meta block">{t("documents.details.requiredReadingHint")}</span>
          </span>
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" loading={saving}>
          {t("documents.details.save")}
        </Button>
      </div>
    </form>
  );
}

/** "I have read this" for a required document's current version. */
export function AcknowledgeButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    const result = await acknowledgeDocument(documentId);
    setSaving(false);
    if (!result.ok) {
      toast(result.error ?? t("documents.acknowledge.failed"), { tone: "error" });
      return;
    }
    toast(t("documents.acknowledge.done"));
    router.refresh();
  }

  return (
    <Button onClick={confirm} loading={saving}>
      <CheckCircle2 className="size-4" aria-hidden />
      {t("documents.acknowledge.button")}
    </Button>
  );
}
