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
import { getDocumentDownloadUrl } from "@/features/documents/services/document.commands";
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
import { formatDate } from "@/lib/utils";

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

function scanLabel(v: VersionRow): string | null {
  if (v.kind !== "file") return null;
  if (v.scan_status === "pending") return "Security check pending";
  if (v.scan_status === "quarantined") return "Quarantined";
  if (v.scan_status === "rejected") return "Rejected";
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
  const [busyId, setBusyId] = useState<string | null>(null);

  async function open(version: VersionRow) {
    setBusyId(version.id);
    const result = await getDocumentDownloadUrl(version.id);
    setBusyId(null);
    if (!result.ok || !result.url) {
      toast(result.error ?? "Could not open this version.", { tone: "error" });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <ol aria-label="Version history" className="divide-y divide-line rounded-(--radius-md) border border-line">
      {versions.map((v) => {
        const current = v.superseded_at === null;
        const label = scanLabel(v);
        return (
          <li
            key={v.id}
            className={`flex flex-wrap items-center gap-3 px-4 py-3 ${v.id === linkedId && !current ? "bg-brand-soft/40" : ""}`}
          >
            <span className="font-medium">Version {v.version_number}</span>
            {current ? <Badge tone="success">Current version</Badge> : <Badge>Earlier version</Badge>}
            {v.archived_at ? <Badge tone="warning">Archived</Badge> : null}
            {label ? (
              <Badge tone={v.scan_status === "pending" ? "warning" : "danger"}>{label}</Badge>
            ) : null}
            <span className="meta">
              Added {formatDate(v.created_at)}
              {v.creator?.full_name ? ` by ${v.creator.full_name}` : ""}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => open(v)}
              loading={busyId === v.id}
              disabled={v.kind === "file" && v.scan_status !== "clean"}
              aria-label={`Open version ${v.version_number}`}
            >
              {v.kind === "link" ? (
                <ExternalLink className="size-4" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              Open
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
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>(currentKind);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleFile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const file = new FormData(e.currentTarget).get("file") as File | null;
    if (!file || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Files must be 25 MB or smaller.");
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
      setError("Upload failed. Check your connection and try again.");
      return;
    }
    const result = await addDocumentVersion({
      kind: "file",
      supersedesId: currentId,
      storagePath: path,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    setSaving(false);
    if (!result.ok) {
      await supabase.storage.from("documents").remove([path]);
      setError(result.error ?? "Could not save the new version.");
      return;
    }
    finish(result.id, "New version uploaded. It opens once its security check passes.");
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
      setError(result.error ?? "Could not save the new version.");
      return;
    }
    finish(result.id, "New version saved.");
  }

  function finish(id: string | undefined, message: string) {
    toast(message);
    setOpen(false);
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
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
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
        Upload new version
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Upload a new version">
        <p className="meta mb-3">
          The current version is kept in the history and stays openable. The new
          version keeps this document&apos;s title, folder, audience and tags.
        </p>
        <Tabs
          tabs={[
            { id: "file", label: "Upload file" },
            { id: "link", label: "External link" },
          ]}
          active={tab}
          onChange={setTab}
        />
        <TabPanel id="file" active={tab}>
          <form onSubmit={handleFile} className="space-y-4">
            <div>
              <Label htmlFor="version-file">File</Label>
              <Input id="version-file" name="file" type="file" required />
              <FieldHint>Up to 25 MB. It opens once its security check passes.</FieldHint>
            </div>
            {footer("Upload version")}
          </form>
        </TabPanel>
        <TabPanel id="link" active={tab}>
          <form onSubmit={handleLink} className="space-y-4">
            <div>
              <Label htmlFor="version-url">URL</Label>
              <Input id="version-url" name="url" type="url" required />
              <FieldHint>Links must be https and point at an approved source.</FieldHint>
            </div>
            {footer("Save version")}
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
      setError(result.error ?? "Could not save the details.");
      return;
    }
    toast("Details saved.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Document details">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="detail-folder">Folder</Label>
          <Select id="detail-folder" name="folderId" defaultValue={folderId ?? ""}>
            <option value="">No folder</option>
            {groupFolders(folders).map((group) => (
              <optgroup key={group.category} label={group.label}>
                {group.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderLabel(f)}
                    {f.visibility === "staff" ? " (staff only)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="detail-tags">Tags</Label>
          <Input
            id="detail-tags"
            name="tags"
            defaultValue={tags.join(", ")}
            maxLength={500}
            placeholder="policy, 2026"
          />
          <FieldHint>Separate tags with commas.</FieldHint>
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
            Required reading
            <span className="meta block">
              Everyone who can open this document is asked to confirm they have
              read it. A new version asks again.
            </span>
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
          Save details
        </Button>
      </div>
    </form>
  );
}

/** "I have read this" for a required document's current version. */
export function AcknowledgeButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    const result = await acknowledgeDocument(documentId);
    setSaving(false);
    if (!result.ok) {
      toast(result.error ?? "Could not record your confirmation.", { tone: "error" });
      return;
    }
    toast("Thank you. Your confirmation is recorded.");
    router.refresh();
  }

  return (
    <Button onClick={confirm} loading={saving}>
      <CheckCircle2 className="size-4" aria-hidden />
      I have read this
    </Button>
  );
}
