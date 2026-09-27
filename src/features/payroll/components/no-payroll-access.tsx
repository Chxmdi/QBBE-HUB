import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/** Shown to staff the database does not let read the books. */
export function NoPayrollAccess({ isAdmin }: { isAdmin: boolean }) {
  return (
    <EmptyState
      icon={<Lock />}
      title="You do not have access to payroll"
      description={
        isAdmin
          ? "Complete multi-factor authentication to open payroll."
          : "Payroll totals are limited to those who read the ledger. An administrator can name you a ledger reader."
      }
    />
  );
}
