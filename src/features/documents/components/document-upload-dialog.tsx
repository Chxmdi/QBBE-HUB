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
} from "@/features/documents/services/document.commands";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Option } from "@/features/tasks/components/task-create-dialog";

const MAX_BYTES = 25 * 1024 * 1024;

/** Upload a file to private storage, or register an external link. */
export function DocumentUploadDialog({
  projects,
  programs,
}: {
  projects: Option[];
  programs: Option[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("file");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  function contextFields(form: FormData) {
    return {
      projectId: (form.get("projectId") as string) || undefined,
      programId: (form.get("programId") as string) || undefined,
      visibility: (form.get("visibility") as string) || "organization",
      description: (form.get("description") as string) || undefined,
    };
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file") as File | null;
    if (!file || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Files must be 25 MB or smaller.");
      return;
    }

    setSaving(true);
    setProgress("Uploading…");
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
      setError("Upload failed. Check your connection and try again.");
      return;
    }

    setProgress("Saving record…");
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
      setError(result.error ?? "Could not save the document record.");
      return;
    }
    toast("Document uploaded.");
    setOpen(false);
    router.refresh();
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
      setError(result.error ?? "Could not save the resource.");
      return;
    }
    toast("Resource added.");
    setOpen(false);
    router.refresh();
  }

  const contextInputs = (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="doc-project">Project</Label>
          <Select id="doc-project" name="projectId" defaultValue="">
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="doc-program">Program</Label>
          <Select id="doc-program" name="programId" defaultValue="">
            <option value="">No program</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="doc-visibility">Who can see this</Label>
        <Select id="doc-visibility" name="visibility" defaultValue="organization">
          <option value="organization">All active members</option>
          <option value="staff">Staff and admins only</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="doc-description">
          Description <span className="font-normal text-muted">(optional)</span>
        </Label>
        <Textarea id="doc-description" name="description" maxLength={2000} rows={2} />
      </div>
    </>
  );

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Add resource
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add a resource">
        <Tabs
          tabs={[
            { id: "file", label: "Upload file" },
            { id: "link", label: "External link" },
          ]}
          active={tab}
          onChange={setTab}
        />

        <TabPanel id="file" active={tab}>
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <Label htmlFor="doc-file">File</Label>
              <Input id="doc-file" name="file" type="file" required />
              <FieldHint>
                Up to 25 MB. Files are stored privately and served through
                short-lived links.
              </FieldHint>
            </div>
            <div>
              <Label htmlFor="doc-file-title">Title</Label>
              <Input
                id="doc-file-title"
                name="title"
                maxLength={200}
                placeholder="Defaults to the file name"
              />
            </div>
            {contextInputs}
            {error ? (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2 pt-1">
              {progress ? <span className="meta">{progress}</span> : null}
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                <Upload className="size-4" aria-hidden />
                Upload
              </Button>
            </div>
          </form>
        </TabPanel>

        <TabPanel id="link" active={tab}>
          <form onSubmit={handleLink} className="space-y-4">
            <div>
              <Label htmlFor="doc-link-title">Title</Label>
              <Input id="doc-link-title" name="title" required maxLength={200} />
            </div>
            <div>
              <Label htmlFor="doc-url">URL</Label>
              <Input
                id="doc-url"
                name="url"
                type="url"
                required
                placeholder="https://drive.google.com/…"
              />
              <FieldHint>
                Use QBBE-controlled Drive links so access stays managed by the
                organization.
              </FieldHint>
            </div>
            {contextInputs}
            {error ? (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Add resource
              </Button>
            </div>
          </form>
        </TabPanel>
      </Dialog>
    </>
  );
}
