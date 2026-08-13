"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import type { Option } from "@/features/tasks/components/task-create-dialog";
import { startConversation } from "@/features/channels/services/message.commands";

export function StartConversationDialog({ people }: { people: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleStart() {
    setError(null);
    setSaving(true);
    const result = await startConversation({ memberIds: Array.from(selected) });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
    if (result.id) router.push(`/messages/${result.id}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        New message
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Start a conversation">
        <div className="space-y-3">
          <Label>Choose participants</Label>
          {people.length === 0 ? (
            <p className="text-[13.5px] text-muted">
              No other active members yet — invite teammates from Admin.
            </p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {people.map((person) => (
                <li key={person.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-(--radius-sm) px-2 py-1.5 text-[13.5px] hover:bg-surface-soft">
                    <input
                      type="checkbox"
                      checked={selected.has(person.id)}
                      onChange={() => toggle(person.id)}
                      className="size-4 accent-(--color-brand)"
                    />
                    {person.label}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleStart}
              loading={saving}
              disabled={selected.size === 0}
            >
              Start conversation
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
