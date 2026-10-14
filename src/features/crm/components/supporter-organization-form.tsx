"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { linkSupporterOrganization } from "@/features/crm/services/supporter.commands";
import { useT } from "@/lib/i18n/client";

/** Links a supporter to one of the CRM's organizations, or to none. */
export function SupporterOrganizationForm({
  contactId,
  current,
  organizations,
}: {
  contactId: string;
  current: string | null;
  organizations: { id: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await linkSupporterOrganization({ contactId, crmOrganizationId: value || null });
    setBusy(false);
    setMessage(
      result.ok
        ? { ok: true, text: t("crm.supporter.saved") }
        : { ok: false, text: result.error ?? t("crm.supporter.saveFailed") },
    );
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-3">
      <Label htmlFor={id}>{t("crm.supporter.chooseOrganization")}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select id={id} value={value} onChange={(event) => setValue(event.target.value)} className="max-w-xs">
          <option value="">{t("crm.supporter.noneOption")}</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" loading={busy} disabled={value === (current ?? "")}>
          {t("crm.supporter.saveOrganization")}
        </Button>
      </div>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "meta mt-1.5" : "mt-1.5 text-[12.5px] text-danger-fg"}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
