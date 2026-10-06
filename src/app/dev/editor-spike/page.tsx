import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { editorSpikesEnabled } from "@/features/editor/spike/enabled";
import { EditorSpike } from "@/features/editor/spike/editor-spike";

// Decided per request, so the gate reads the environment the server runs in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Editor spike",
  robots: { index: false, follow: false },
};

/**
 * W0-5 / W0-6 spike route. 404 in production (see enabled.ts). Signing in is
 * still required: the request proxy guards every non-public path.
 */
export default async function EditorSpikePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!editorSpikesEnabled()) notFound();
  const { doc, raw, flush } = await searchParams;
  const docId = typeof doc === "string" && /^[a-z0-9-]{1,64}$/.test(doc) ? doc : null;
  // ?raw=1 shows BlockNote without the W0-5 mitigations, for comparison.
  // ?flush=<ms> sets how long local changes are batched before sending (W0-6).
  const flushMs = typeof flush === "string" && /^\d{1,4}$/.test(flush) ? Number(flush) : undefined;
  return <EditorSpike docId={docId} raw={raw === "1"} flushMs={flushMs} />;
}
