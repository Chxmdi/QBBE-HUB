"use client";

import { useRouter } from "next/navigation";
import { leaveChannel } from "@/features/channels/services/channel.commands";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";

export function LeaveChannelButton({ channelId }: { channelId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();

  async function leave() {
    if (!window.confirm(t("channels.leave.confirm"))) {
      return;
    }
    const result = await leaveChannel(channelId);
    if (!result.ok) {
      toast(result.error ?? t("channels.errors.leaveFailed"), { tone: "error" });
      return;
    }
    router.push("/channels");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={leave}
      className="text-[12.5px] font-medium text-danger-fg hover:underline"
    >
      {t("channels.leave.button")}
    </button>
  );
}
