"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createSigningDocument } from "@/features/forms/services/signature.commands";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Upload a PDF and choose who must sign it. The file goes into the private
 * signing-documents bucket under the admin's own folder; the record is then
 * saved by the server, and the upload removed again if that fails.
 */
export function SendForSignatureDialog({
  organizationId,
  userId,
  members,
}: {
  organizationId: string;
  userId: string;
  members: { id: string; label: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file") as File | null;
    const signerIds = form.getAll("signer").map(String);
    if (!file || file.size === 0) {
      setError("Choose the PDF to be signed.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Files must be 25 MB or smaller.");
      return;
    }
    if (signerIds.length === 0) {
      setError("Choose at least one person to sign.");
      return;
    }
    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "document.pdf";
    const path = `${organizationId}/${userId}/${crypto.randomUUID()}/${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("signing-documents")
      .upload(path, file, { contentType: "application/pdf" });
    if (uploadError) {
      setSaving(false);
      setError("Upload failed. Only PDF files can be sent for signature; check your connection and try again.");
      return;
    }
    const result = await createSigningDocument({
      title: form.get("title"),
      message: (form.get("message") as string) || undefined,
      storagePath: path,
      fileName: file.name.slice(-200) || safeName,
      signerIds,
    });
    setSaving(false);
    if (!result.ok || !result.id) {
      await supabase.storage.from("signing-documents").remove([path]);
      setError(result.error ?? "Could not send the document.");
      return;
    }
    toast("Sent for signature. It can be signed once its security check passes.");
    setOpen(false);
    router.push(`/signatures/${result.id}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Send a PDF for signature
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Send a PDF for signature">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="sd-title">Title</Label>
            <Input id="sd-title" name="title" required maxLength={200} placeholder="Volunteer agreement 2026" />
          </div>
          <div>
            <Label htmlFor="sd-file">PDF</Label>
            <Input id="sd-file" name="file" type="file" required accept="application/pdf" />
            <FieldHint>Up to 25 MB. The file cannot be changed once sent.</FieldHint>
          </div>
          <div>
            <Label htmlFor="sd-message">
              Message to signers <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Textarea id="sd-message" name="message" maxLength={2000} rows={2} />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Who must sign</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-(--radius-sm) border border-line p-2">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-[13px]">
                  <Checkbox name="signer" value={m.id} />
                  {m.label}
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Send className="size-4" aria-hidden />
              Send
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
