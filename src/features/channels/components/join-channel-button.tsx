"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { joinChannel } from "@/features/channels/services/channel.commands";

export function JoinChannelButton({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  async function handleJoin() {
    setState("saving");
    const result = await joinChannel(channelId);
    if (!result.ok) {
      setState("error");
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={handleJoin} loading={state === "saving"}>
        Join
      </Button>
      {state === "error" ? (
        <span role="alert" className="text-[12px] text-danger-fg">
          Couldn&apos;t join
        </span>
      ) : null}
    </span>
  );
}
