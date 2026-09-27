import Link from "next/link";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { getT } from "@/lib/i18n/server";

/** Shown to staff the database does not let read the books. */
export async function NoBudgetAccess({ isAdmin }: { isAdmin: boolean }) {
  const t = await getT();
  return (
    <EmptyState
      icon={<Lock />}
      title={t("finance.budgets.noAccess.title")}
      description={
        isAdmin
          ? t("finance.budgets.noAccess.admin")
          : t("finance.budgets.noAccess.staff")
      }
      action={
        <Link className="text-[13.5px] font-medium text-brand-fg hover:underline" href="/finance/budgets/programs">
          {t("finance.budgets.noAccess.link")}
        </Link>
      }
    />
  );
}
