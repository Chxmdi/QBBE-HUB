"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { restoreTasks } from "@/features/tasks/services/task.commands";
import { useT } from "@/lib/i18n/client";

export function RestoreTaskButton({ taskId }: { taskId: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        const result = await restoreTasks([taskId]);
        if (result.ok) router.refresh();
      }}
    >
      {t("tasks.restore")}
    </Button>
  );
}
