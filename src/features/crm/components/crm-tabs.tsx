"use client";

import { LinkTabs } from "@/components/shared/link-tabs";
import { useT } from "@/lib/i18n/client";

/** Sections of the relationship CRM, each its own page. */
export function CrmTabs({ active }: { active: "organizations" | "supporters" | "zeffy" }) {
  const t = useT();
  return (
    <LinkTabs
      active={active}
      className="mb-6"
      tabs={[
        { id: "organizations", label: t("crm.tabs.organizations"), href: "/crm" },
        { id: "supporters", label: t("crm.tabs.supporters"), href: "/crm/supporters" },
        { id: "zeffy", label: t("crm.tabs.zeffy"), href: "/crm/zeffy" },
      ]}
    />
  );
}
