"use client";

import { useRouter } from "next/navigation";
import { leaveChannel } from "@/features/channels/services/channel.commands";
import { useToast } from "@/components/ui/toast";

export function LeaveChannelButton({ channelId }: { channelId: string }) {
  const router = useRouter();
  const { toast } = useToast();

  async function leave() {
    if (!window.confirm("Leave this channel? You can rejoin public channels later.")) {
      return;
    }
    const result = await leaveChannel(channelId);
    if (!result.ok) {
      toast(result.error ?? "You cannot leave this channel.", { tone: "error" });
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
      Leave
    </button>
  );
}
