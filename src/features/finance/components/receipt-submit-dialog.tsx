"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { registerReceipt } from "@/features/finance/services/receipt.commands";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Option } from "@/features/tasks/components/task-create-dialog";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Photograph or upload a receipt or bill and type the figures the accountant
 * needs. The file goes into the private receipts bucket first, under the
 * submitter's own folder; the record is then saved by the server, and the
 * upload is removed again if that fails.
 */
export function ReceiptSubmitDialog({
  organizationId,
  userId,
  programs,
  projects,
}: {
  organizationId: string;
  userId: string;
  programs: Option[];
  projects: (Option & { programId: string | null })[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [programId, setProgramId] = useState("");
  const today = new Date().toLocaleDateString("en-CA");

  const projectChoices = programId
    ? projects.filter((p) => p.programId === programId)
    : projects;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file") as File | null;
    if (!file || file.size === 0) {
      setError("Take a photo of the receipt or choose its file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Files must be 25 MB or smaller.");
      return;
    }

    setSaving(true);
    setProgress("Uploading…");
    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "receipt";
    // The database checks that the first two segments are this organization
    // and this person; the random segment avoids collisions.
    const path = `${organizationId}/${userId}/${crypto.randomUUID()}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      setSaving(false);
      setProgress(null);
      setError(
        "Upload failed. Receipts must be a photo (JPEG, PNG, HEIC, WebP) or a PDF; check your connection and try again.",
      );
      return;
    }

    setProgress("Saving…");
    const result = await registerReceipt({
      kind: form.get("kind") || "receipt",
      documentDate: form.get("documentDate"),
      vendor: form.get("vendor"),
      total: form.get("total"),
      gst: form.get("gst") ?? "",
      qst: form.get("qst") ?? "",
      programId: (form.get("programId") as string) || undefined,
      projectId: (form.get("projectId") as string) || undefined,
      note: (form.get("note") as string) || undefined,
      storagePath: path,
      fileName: file.name.slice(-200) || safeName,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    setSaving(false);
    setProgress(null);

    if (!result.ok) {
      await supabase.storage.from("receipts").remove([path]);
      setError(result.error ?? "Could not save the receipt.");
      return;
    }
    toast("Receipt submitted. The file opens once its security check passes.");
    setOpen(false);
    setProgramId("");
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Submit receipt
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Submit a receipt or bill">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="rc-file">Photo or PDF</Label>
            <Input
              id="rc-file"
              name="file"
              type="file"
              required
              accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
            />
            <FieldHint>
              On a phone this opens the camera. Up to 25 MB. Keep the paper until
              the file shows as checked.
            </FieldHint>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="rc-kind">Type</Label>
              <Select id="rc-kind" name="kind" defaultValue="receipt">
                <option value="receipt">Receipt (already paid)</option>
                <option value="bill">Bill or invoice (to pay)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rc-date">Date on the receipt</Label>
              <Input id="rc-date" name="documentDate" type="date" required max={today} defaultValue={today} />
            </div>
          </div>
          <div>
            <Label htmlFor="rc-vendor">Paid to</Label>
            <Input id="rc-vendor" name="vendor" required maxLength={200} placeholder="Store or supplier" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="rc-total">Total</Label>
              <Input id="rc-total" name="total" required inputMode="decimal" placeholder="42.18" />
            </div>
            <div>
              <Label htmlFor="rc-gst">GST</Label>
              <Input id="rc-gst" name="gst" inputMode="decimal" placeholder="0.00" />
            </div>
            <div>
              <Label htmlFor="rc-qst">QST</Label>
              <Input id="rc-qst" name="qst" inputMode="decimal" placeholder="0.00" />
            </div>
          </div>
          <FieldHint>Total includes taxes. Leave GST and QST empty if none are shown.</FieldHint>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="rc-program">Program</Label>
              <Select
                id="rc-program"
                name="programId"
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
              >
                <option value="">No program</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rc-project">Project</Label>
              <Select id="rc-project" name="projectId" defaultValue="" key={programId}>
                <option value="">No project</option>
                {projectChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="rc-note">
              What was it for? <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Textarea id="rc-note" name="note" maxLength={2000} rows={2} />
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            {progress ? <span className="meta">{progress}</span> : null}
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Camera className="size-4" aria-hidden />
              Submit
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
