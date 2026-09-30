/**
 * The hand-over into the capture inbox (V1-15 to M18). The capture inbox is
 * built by S5 and does not exist yet, so this module defines the smallest
 * contract it needs and writes to capture_forward, a per-person table the
 * inbox can read. Listed under "Contract additions" in the PR.
 */

export type CaptureSource = "gmail";

export interface CaptureItemInput {
  source: CaptureSource;
  /** The row the item came from: gmail_message.id. The database copies the text from it. */
  sourceId: string;
}

export interface CaptureItem {
  id: string;
  source: CaptureSource;
  sourceId: string;
  title: string;
  body: string | null;
  sender: string | null;
  receivedAt: string | null;
  status: "new" | "triaged" | "dismissed";
  createdAt: string;
}

export type SubmitToCapture = (item: CaptureItemInput) => Promise<{ ok: true; id: string } | { ok: false; reason: "duplicate" | "forbidden" | "failed" }>;
