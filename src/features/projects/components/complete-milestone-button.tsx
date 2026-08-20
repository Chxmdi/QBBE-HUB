"use client";

import { useRouter } from "next/navigation";
import { completeMilestone } from "@/features/projects/services/milestone.commands";

export function CompleteMilestoneButton({
  milestoneId,
  completed,
}: {
  milestoneId: string;
  completed: boolean;
}) {
  const router = useRouter();

  async function toggle() {
    await completeMilestone(milestoneId, !completed);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="text-[12.5px] font-medium text-brand-fg hover:underline"
    >
      {completed ? "Reopen" : "Complete"}
    </button>
  );
}
