"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pin, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { unpinResource } from "@/features/channels/services/message.commands";

export interface PinnedResourceRow {
  id: string;
  title: string;
  url: string | null;
  message_id: string | null;
}

/**
 * Durable channel resource panel (P0-RES-02). Pins reference source records
 * rather than copying their content into message text.
 */
export function PinnedResources({
  channelId,
  resources,
  canManage,
}: {
  channelId: string;
  resources: PinnedResourceRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  if (resources.length === 0) return null;

  async function remove(id: string) {
    const result = await unpinResource(id, channelId);
    if (result.ok) {
      toast("Pin removed.");
      router.refresh();
    } else {
      toast(result.error ?? "Could not remove the pin.", { tone: "error" });
    }
  }

  const shown = expanded ? resources : resources.slice(0, 3);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-soft/50 px-4 py-2 md:px-6">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
        <Pin className="size-3.5" aria-hidden />
        Pinned
      </span>
      {shown.map((resource) => (
        <span
          key={resource.id}
          className="flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[12.5px]"
        >
          {resource.message_id ? (
            <a
              href={`#message-${resource.message_id}`}
              className="max-w-56 truncate hover:text-brand"
            >
              {resource.title}
            </a>
          ) : resource.url ? (
            <a
              href={resource.url}
              target="_blank"
              rel="noreferrer noopener"
              className="max-w-56 truncate hover:text-brand"
            >
              {resource.title}
            </a>
          ) : (
            <span className="max-w-56 truncate">{resource.title}</span>
          )}
          {canManage ? (
            <button
              type="button"
              onClick={() => remove(resource.id)}
              aria-label={`Remove pin: ${resource.title}`}
              className="text-muted hover:text-danger"
            >
              <X className="size-3" aria-hidden />
            </button>
          ) : null}
        </span>
      ))}
      {resources.length > 3 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[12.5px] font-medium text-brand hover:underline"
        >
          +{resources.length - 3} more
        </button>
      ) : null}
    </div>
  );
}
