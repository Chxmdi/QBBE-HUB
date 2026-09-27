"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, FilePlus2, FileText, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  archiveTemplate,
  generateFromTemplate,
  saveTemplate,
} from "@/features/documents/services/template.commands";
import {
  PLACEHOLDERS,
  RECORD_TYPES,
  TEMPLATE_KINDS,
  TEMPLATE_LANGUAGES,
  type RecordType,
} from "@/features/documents/templates/merge";
import {
  folderLabel,
  groupFolders,
  type LibraryFolder,
} from "@/features/documents/services/library";

export interface TemplateRow {
  id: string;
  name: string;
  kind: "letter" | "contract" | "acknowledgement";
  language: "fr" | "en";
  record_type: RecordType;
  body: string;
  folder_id: string | null;
}

export type RecordOption = { id: string; label: string };

function FolderSelect({
  id,
  folders,
  defaultValue,
  emptyLabel,
}: {
  id: string;
  folders: LibraryFolder[];
  defaultValue: string;
  emptyLabel: string;
}) {
  return (
    <Select id={id} name="folderId" defaultValue={defaultValue}>
      <option value="">{emptyLabel}</option>
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
  );
}

/** The fields a template may use, for the record type chosen. */
function PlaceholderList({ recordType }: { recordType: RecordType }) {
  const fields = { ...PLACEHOLDERS.common, ...PLACEHOLDERS[recordType] };
  return (
    <div className="rounded-lg bg-surface-soft p-3 text-[12.5px]">
      <p className="mb-1 font-medium">Fields you can use</p>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {Object.entries(fields).map(([name, field]) => (
          <li key={name} className="min-w-0 break-words">
            <code className="text-ink">{`{{${name}}}`}</code>{" "}
            <span className="text-muted">{field.help}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Owners and admins write and edit templates. */
export function TemplateEditorDialog({
  template,
  folders,
}: {
  template?: TemplateRow;
  folders: LibraryFolder[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recordType, setRecordType] = useState<RecordType>(template?.record_type ?? "member");
  const prefix = template ? `tpl-${template.id}` : "tpl-new";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await saveTemplate({
      id: template?.id,
      name: form.get("name"),
      kind: form.get("kind"),
      language: form.get("language"),
      recordType: form.get("recordType"),
      body: form.get("body"),
      folderId: (form.get("folderId") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save the template.");
      return;
    }
    toast(template ? "Template saved." : "Template created.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      {template ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Edit ${template.name}`}>
          <Pencil className="size-4" aria-hidden />
          Edit
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <FilePlus2 className="size-4" aria-hidden />
          New template
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={template ? "Edit template" : "New template"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor={`${prefix}-name`}>Name</Label>
            <Input id={`${prefix}-name`} name="name" required maxLength={120} defaultValue={template?.name} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor={`${prefix}-kind`}>Type</Label>
              <Select id={`${prefix}-kind`} name="kind" defaultValue={template?.kind ?? "letter"}>
                {TEMPLATE_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.en}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${prefix}-language`}>Language</Label>
              <Select id={`${prefix}-language`} name="language" defaultValue={template?.language ?? "en"}>
                {TEMPLATE_LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${prefix}-record`}>Merges</Label>
              <Select
                id={`${prefix}-record`}
                name="recordType"
                value={recordType}
                onChange={(e) => setRecordType(e.target.value as RecordType)}
              >
                {RECORD_TYPES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor={`${prefix}-body`}>Text</Label>
            <Textarea
              id={`${prefix}-body`}
              name="body"
              required
              maxLength={20000}
              rows={10}
              defaultValue={template?.body}
              aria-describedby={`${prefix}-body-hint`}
            />
            <p id={`${prefix}-body-hint`} className="mt-1 text-[12.5px] text-muted">
              Plain text. Leave a blank line between paragraphs. Names, amounts and
              dates are filled in exactly as recorded and are never treated as
              formatting.
            </p>
          </div>
          <PlaceholderList recordType={recordType} />
          <div>
            <Label htmlFor={`${prefix}-folder`}>File generated documents in</Label>
            <FolderSelect
              id={`${prefix}-folder`}
              folders={folders}
              defaultValue={template?.folder_id ?? ""}
              emptyLabel="No folder"
            />
          </div>
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
              Save template
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function TemplateArchiveButton({ template }: { template: TemplateRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function archive() {
    setBusy(true);
    const result = await archiveTemplate(template.id);
    setBusy(false);
    if (!result.ok) {
      toast(result.error ?? "Could not archive the template.", { tone: "error" });
      return;
    }
    toast("Template archived.");
    router.refresh();
  }
  return (
    <Button variant="ghost" size="sm" onClick={archive} loading={busy} aria-label={`Archive ${template.name}`}>
      <Archive className="size-4" aria-hidden />
      Archive
    </Button>
  );
}

/** Staff generate a document from a template and one record. */
export function GenerateDialog({
  template,
  records,
  folders,
}: {
  template: TemplateRow;
  records: RecordOption[];
  folders: LibraryFolder[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const prefix = `gen-${template.id}`;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await generateFromTemplate({
      templateId: template.id,
      recordId: form.get("recordId"),
      folderId: (form.get("folderId") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not generate the document.");
      return;
    }
    toast("Document generated and filed in the library.");
    setOpen(false);
    router.push(`/documents/${result.id}`);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={`Generate from ${template.name}`}>
        <FileText className="size-4" aria-hidden />
        Generate
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Generate: ${template.name}`}>
        {records.length === 0 ? (
          <p className="text-[13px] text-muted">
            There are no records of this kind that you can read, so nothing can be
            merged into this template.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor={`${prefix}-record`}>
                {RECORD_TYPES.find((r) => r.id === template.record_type)?.label ?? "Record"}
              </Label>
              <Select id={`${prefix}-record`} name="recordId" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${prefix}-folder`}>Folder</Label>
              <FolderSelect
                id={`${prefix}-folder`}
                folders={folders}
                defaultValue={template.folder_id ?? ""}
                emptyLabel="No folder"
              />
            </div>
            <FieldHint>
              A staff-only folder limits who can open the document. It is saved as a
              PDF in the library and opens once its security check passes.
            </FieldHint>
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
                Generate document
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
