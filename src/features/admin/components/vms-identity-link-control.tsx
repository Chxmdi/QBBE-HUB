"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { linkVmsIdentity } from "@/features/admin/services/integration.commands";

export function VmsIdentityLinkControl({
  userId,
  vmsId,
  availability,
}: {
  userId: string;
  vmsId: string | null;
  availability: string | null;
}) {
  const [value, setValue] = useState(vmsId ?? "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function save() {
    setSaving(true);
    const result = await linkVmsIdentity(userId, value);
    setSaving(false);
    if (!result.ok) {
      toast(result.error ?? "Could not update VMS identity.", { tone: "error" });
      return;
    }
    toast(value.trim() ? "VMS identity linked." : "VMS identity unlinked.");
  }

  return (
    <div className="min-w-52 space-y-1.5">
      <div className="flex gap-1.5">
        <Input
          aria-label="VMS identity"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={200}
          placeholder="VMS id"
        />
        <Button type="button" variant="secondary" onClick={save} loading={saving}>
          Save
        </Button>
      </div>
      <p className="meta">
        {vmsId ? `Availability: ${availability ?? "unknown"}` : "Not linked"}
      </p>
    </div>
  );
}
