"use client";

import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { setChannelArchived } from "@/features/channels/services/channel.commands";
import { useT } from "@/lib/i18n/client";

/** Channel governance actions for owners/admins (P0-COMM-05, P0-GOV-03). */
export function ChannelAdminMenu({
  channelId,
  archived,
}: {
  channelId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();

  async function toggleArchive() {
    if (
      !archived &&
      !window.confirm(t("channels.admin.archiveConfirm"))
    )
      return;
    const result = await setChannelArchived(channelId, !archived);
    if (!result.ok) {
      toast(result.error ?? t("channels.errors.updateFailed"), { tone: "error" });
      return;
    }
    toast(archived ? t("channels.admin.restored") : t("channels.admin.archived"));
    router.refresh();
  }

  return (
    <Menu
      label={t("channels.admin.menuLabel")}
      items={[
        {
          label: archived ? t("channels.admin.restore") : t("channels.admin.archive"),
          onSelect: toggleArchive,
          icon: archived ? (
            <ArchiveRestore className="size-4" aria-hidden />
          ) : (
            <Archive className="size-4" aria-hidden />
          ),
          destructive: !archived,
        },
      ]}
    />
  );
}
