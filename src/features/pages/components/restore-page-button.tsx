"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { usePagesT } from "@/features/pages/i18n/client";
import { restorePage } from "@/features/pages/services/page.commands";

export function RestorePageButton({ pageId }: { pageId: string }) {
  const t = usePagesT();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await restorePage({ pageId });
          if (!result.ok) {
            toast(result.error ?? t("errors.failed"), { tone: "error" });
            return;
          }
          toast(t("toasts.restored"), { tone: "success" });
          router.refresh();
        })
      }
    >
      {t("actions.restore")}
    </Button>
  );
}
