"use client";

import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/i18n/client";

/** Shown to staff the database does not let read the books. */
export function NoLedgerAccess({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  return (
    <EmptyState
      icon={<Lock />}
      title={t("finance.ledger.noAccess.title")}
      description={isAdmin ? t("finance.ledger.noAccess.adminHint") : t("finance.ledger.noAccess.staffHint")}
    />
  );
}
