import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/** Shown to staff the database does not let read the books. */
export function NoLedgerAccess({ isAdmin }: { isAdmin: boolean }) {
  return (
    <EmptyState
      icon={<Lock />}
      title="You do not have access to the ledger"
      description={
        isAdmin
          ? "Complete multi-factor authentication to open the books."
          : "The ledger is limited to finance staff. Ask an administrator to give you read access."
      }
    />
  );
}
