import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { getT } from "@/lib/i18n/server";

/** Shown to staff the database does not let read the books. */
export async function NoPayrollAccess({ isAdmin }: { isAdmin: boolean }) {
  const t = await getT();
  return (
    <EmptyState
      icon={<Lock />}
      title={t("finance.payroll.noAccess.title")}
      description={isAdmin ? t("finance.payroll.noAccess.needsMfa") : t("finance.payroll.noAccess.notReader")}
    />
  );
}
