import Link from "next/link";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/** Shown to staff the database does not let read the books. */
export function NoBudgetAccess({ isAdmin }: { isAdmin: boolean }) {
  return (
    <EmptyState
      icon={<Lock />}
      title="You do not have access to budgets"
      description={
        isAdmin
          ? "Complete multi-factor authentication to open budgets."
          : "Budgets are limited to those who read the ledger. If you lead or manage a program, you can follow its spending under My programs."
      }
      action={
        <Link className="text-[13.5px] font-medium text-brand-fg hover:underline" href="/finance/budgets/programs">
          Go to My programs
        </Link>
      }
    />
  );
}
