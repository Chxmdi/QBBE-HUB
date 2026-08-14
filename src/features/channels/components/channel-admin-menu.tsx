"use client";

import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { setChannelArchived } from "@/features/channels/services/channel.commands";

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

  async function toggleArchive() {
    if (
      !archived &&
      !window.confirm(
        "Archive this channel? History is preserved and stays searchable for members, but the channel becomes read-only.",
      )
    )
      return;
    const result = await setChannelArchived(channelId, !archived);
    if (!result.ok) {
      toast(result.error ?? "Could not update the channel.", { tone: "error" });
      return;
    }
    toast(archived ? "Channel restored." : "Channel archived and read-only.");
    router.refresh();
  }

  return (
    <Menu
      label="Channel settings"
      items={[
        {
          label: archived ? "Restore channel" : "Archive channel",
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
