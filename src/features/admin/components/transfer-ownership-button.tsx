"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { transferOwnership } from "@/features/admin/services/admin.commands";

export function TransferOwnershipButton({
  membershipId,
  name,
}: {
  membershipId: string;
  name: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleTransfer() {
    if (
      !window.confirm(
        `Transfer Primary Owner to ${name}? You will become a Workspace Admin.`,
      )
    ) {
      return;
    }
    setError(null);
    const result = await transferOwnership(membershipId);
    if (!result.ok) {
      setError(result.error ?? "Transfer failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleTransfer}
        className="text-[12.5px] font-medium text-brand-fg hover:underline"
      >
        Make owner
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
