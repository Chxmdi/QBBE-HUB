"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";

export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const t = useT();

  async function markRead() {
    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    await supabase
      .from("notification")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={markRead}
      disabled={saving}
      aria-label={t("inbox.markRead")}
      title={t("inbox.markRead")}
      className="rounded-(--radius-sm) p-1.5 text-muted transition-colors hover:bg-surface-soft hover:text-success-fg disabled:opacity-50"
    >
      <Check className="size-4" aria-hidden />
    </button>
  );
}
