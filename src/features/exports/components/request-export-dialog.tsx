"use client";

import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import {
  EXPORT_KINDS,
  exportKindDescription,
  exportKindLabel,
} from "@/features/exports/schemas";
import { useT } from "@/lib/i18n/client";
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
  const t = useT();
  return (
    <EntityFormDialog
      triggerLabel={t("exports.request.trigger")}
      title={t("exports.request.title")}
      submitLabel={t("exports.request.submit")}
      action={requestExport}
      fields={[
        {
          name: "kind",
          label: t("exports.request.kind"),
          type: "select",
          required: true,
          defaultValue: "crm_contacts",
          options: EXPORT_KINDS.map((kind) => ({
            value: kind,
            label: t("exports.kindOption", {
              label: exportKindLabel(kind, t),
              description: exportKindDescription(kind, t),
            }),
          })),
        },
        {
          name: "subjectUserId",
          label: t("exports.request.person"),
          type: "select",
          options: people,
          hint: t("exports.request.personHint"),
        },
      ]}
    />
  );
}
