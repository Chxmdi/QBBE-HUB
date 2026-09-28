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
  placeholderHelp,
  RECORD_TYPES,
  recordTypeLabel,
  TEMPLATE_KINDS,
  TEMPLATE_LANGUAGES,
  templateKindLabel,
  type RecordType,
} from "@/features/documents/templates/merge";
import { useT } from "@/lib/i18n/client";
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
  const t = useT();
  return (
    <Select id={id} name="folderId" defaultValue={defaultValue}>
      <option value="">{emptyLabel}</option>
      {groupFolders(folders, t).map((group) => (
        <optgroup key={group.category} label={group.label}>
          {group.folders.map((f) => (
            <option key={f.id} value={f.id}>
              {folderLabel(f, t)}
              {f.visibility === "staff" ? t("documents.templates.staffOnlySuffix") : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** The fields a template may use, for the record type chosen. */
function PlaceholderList({ recordType }: { recordType: RecordType }) {
  const t = useT();
  const fields = { ...PLACEHOLDERS.common, ...PLACEHOLDERS[recordType] };
  return (
    <div className="rounded-lg bg-surface-soft p-3 text-[12.5px]">
      <p className="mb-1 font-medium">{t("documents.templates.fieldsHeading")}</p>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {Object.keys(fields).map((name) => (
          <li key={name} className="min-w-0 break-words">
            <code className="text-ink">{`{{${name}}}`}</code>{" "}
            <span className="text-muted">{placeholderHelp(name, t)}</span>
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
  const t = useT();
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
      setError(result.error ?? t("documents.templates.editor.saveFailed"));
      return;
    }
    toast(template ? t("documents.templates.editor.saved") : t("documents.templates.editor.created"));
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      {template ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={t("documents.templates.editor.editAria", { name: template.name })}>
          <Pencil className="size-4" aria-hidden />
          {t("documents.templates.editor.edit")}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <FilePlus2 className="size-4" aria-hidden />
          {t("documents.templates.editor.newTrigger")}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={
          template
            ? t("documents.templates.editor.editTitle")
            : t("documents.templates.editor.newTitle")
        }>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor={`${prefix}-name`}>{t("documents.templates.editor.name")}</Label>
            <Input id={`${prefix}-name`} name="name" required maxLength={120} defaultValue={template?.name} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor={`${prefix}-kind`}>{t("documents.templates.editor.type")}</Label>
              <Select id={`${prefix}-kind`} name="kind" defaultValue={template?.kind ?? "letter"}>
                {TEMPLATE_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {templateKindLabel(k.id, t)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${prefix}-language`}>{t("documents.templates.editor.language")}</Label>
              <Select id={`${prefix}-language`} name="language" defaultValue={template?.language ?? "en"}>
                {TEMPLATE_LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${prefix}-record`}>{t("documents.templates.editor.merges")}</Label>
              <Select
                id={`${prefix}-record`}
                name="recordType"
                value={recordType}
                onChange={(e) => setRecordType(e.target.value as RecordType)}
              >
                {RECORD_TYPES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {recordTypeLabel(r.id, t)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor={`${prefix}-body`}>{t("documents.templates.editor.text")}</Label>
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
              {t("documents.templates.editor.textHint")}
            </p>
          </div>
          <PlaceholderList recordType={recordType} />
          <div>
            <Label htmlFor={`${prefix}-folder`}>{t("documents.templates.editor.folder")}</Label>
            <FolderSelect
              id={`${prefix}-folder`}
              folders={folders}
              defaultValue={template?.folder_id ?? ""}
              emptyLabel={t("documents.templates.editor.noFolder")}
            />
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("documents.templates.editor.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("documents.templates.editor.submit")}
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
  const t = useT();
  const [busy, setBusy] = useState(false);
  async function archive() {
    setBusy(true);
    const result = await archiveTemplate(template.id);
    setBusy(false);
    if (!result.ok) {
      toast(result.error ?? t("documents.templates.archive.failed"), { tone: "error" });
      return;
    }
    toast(t("documents.templates.archive.done"));
    router.refresh();
  }
  return (
    <Button variant="ghost" size="sm" onClick={archive} loading={busy} aria-label={t("documents.templates.archive.aria", { name: template.name })}>
      <Archive className="size-4" aria-hidden />
      {t("documents.templates.archive.button")}
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
  const t = useT();
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
      setError(result.error ?? t("documents.templates.generate.failed"));
      return;
    }
    toast(t("documents.templates.generate.done"));
    setOpen(false);
    router.push(`/documents/${result.id}`);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={t("documents.templates.generate.aria", { name: template.name })}>
        <FileText className="size-4" aria-hidden />
        {t("documents.templates.generate.button")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("documents.templates.generate.title", { name: template.name })}
      >
        {records.length === 0 ? (
          <p className="text-[13px] text-muted">
            {t("documents.templates.generate.noRecords")}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor={`${prefix}-record`}>
                {RECORD_TYPES.some((r) => r.id === template.record_type)
                  ? recordTypeLabel(template.record_type, t)
                  : t("documents.templates.generate.record")}
              </Label>
              <Select id={`${prefix}-record`} name="recordId" required defaultValue="">
                <option value="" disabled>
                  {t("documents.templates.generate.choose")}
                </option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${prefix}-folder`}>{t("documents.templates.generate.folder")}</Label>
              <FolderSelect
                id={`${prefix}-folder`}
                folders={folders}
                defaultValue={template.folder_id ?? ""}
                emptyLabel={t("documents.templates.generate.noFolder")}
              />
            </div>
            <FieldHint>{t("documents.templates.generate.hint")}</FieldHint>
            {error ? (
              <p role="alert" className="text-[13px] text-danger-fg">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t("documents.templates.generate.cancel")}
              </Button>
              <Button type="submit" loading={saving}>
                {t("documents.templates.generate.submit")}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
