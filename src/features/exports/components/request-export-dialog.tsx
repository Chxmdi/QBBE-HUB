"use client";

import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import {
  EXPORT_KINDS,
  EXPORT_KIND_DESCRIPTIONS,
  EXPORT_KIND_LABELS,
} from "@/features/exports/schemas";
import { requestExport } from "@/features/exports/services/export.commands";

/**
 * Requesting an export.
 *
 * The person field is always shown rather than revealed by the kind, because a
 * select that changes the shape of the form beneath it is harder to use than
 * one extra optional field — and the hint says exactly when it is needed. The
 * schema and the database both refuse a person export without a subject, so
 * leaving it blank produces a sentence rather than a broken export.
 */
export function RequestExportDialog({
  people,
}: {
  people: { value: string; label: string }[];
}) {
  return (
    <EntityFormDialog
      triggerLabel="Request an export"
      title="Request a data export"
      submitLabel="Queue it"
      action={requestExport}
      fields={[
        {
          name: "kind",
          label: "What to export",
          type: "select",
          required: true,
          defaultValue: "crm_contacts",
          options: EXPORT_KINDS.map((kind) => ({
            value: kind,
            label: `${EXPORT_KIND_LABELS[kind]} — ${EXPORT_KIND_DESCRIPTIONS[kind]}`,
          })),
        },
        {
          name: "subjectUserId",
          label: "About which person",
          type: "select",
          options: people,
          hint: "Required only for a subject access request.",
        },
      ]}
    />
  );
}
