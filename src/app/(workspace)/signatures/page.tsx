import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SendForSignatureDialog } from "@/features/forms/components/send-for-signature-dialog";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { formatInZone } from "@/lib/time";

export const metadata: Metadata = { title: "Signatures" };
export const dynamic = "force-dynamic";

interface DocumentRow {
  id: string;
  title: string;
  created_at: string;
  scan_status: string;
  signing_document_signer: { user_id: string }[];
  signature: { signer_id: string }[];
}

export default async function SignaturesPage() {
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  const [{ data: documents }, { data: members }] = await Promise.all([
    supabase
      .from("signing_document")
      .select("id, title, created_at, scan_status, signing_document_signer(user_id), signature(signer_id)")
      .order("created_at", { ascending: false })
      .limit(500),
    session.isAdmin
      ? supabase
          .from("organization_membership")
          .select("user_id, user_profile:user_id(full_name)")
          .eq("organization_id", session.organizationId)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
  ]);
  const rows = (documents ?? []) as unknown as DocumentRow[];
  const mine = rows.filter((d) => d.signing_document_signer.some((s) => s.user_id === session.userId));
  const waiting = mine.filter((d) => !d.signature.some((s) => s.signer_id === session.userId));
  const signed = mine.filter((d) => d.signature.some((s) => s.signer_id === session.userId));
  const memberOptions = ((members ?? []) as unknown as { user_id: string; user_profile: { full_name: string } | null }[])
    .map((m) => ({ id: m.user_id, label: m.user_profile?.full_name ?? "Member" }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const list = (items: DocumentRow[]) => (
    <ul className="space-y-2">
      {items.map((d) => (
        <li key={d.id} className="card flex flex-wrap items-center justify-between gap-2 p-3">
          <Link href={`/signatures/${d.id}`} className="font-medium text-brand-fg hover:underline">
            {d.title}
          </Link>
          <span className="meta">Sent {formatInZone(d.created_at, session.timeZone, { dateStyle: "medium" })}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Paperless"
        title="Signatures"
        description="Documents you are asked to sign electronically. Each signature records your name, your account, the time, and a SHA-256 fingerprint of exactly what you signed."
        actions={
          session.isAdmin ? (
            <SendForSignatureDialog
              organizationId={session.organizationId}
              userId={session.userId}
              members={memberOptions}
            />
          ) : null
        }
      />

      <section aria-labelledby="waiting" className="space-y-3">
        <h2 id="waiting" className="text-[15px] font-semibold">
          Waiting for your signature
        </h2>
        {waiting.length === 0 ? (
          <EmptyState icon={<FileSignature />} title="Nothing to sign" description="Documents sent to you for signature appear here." />
        ) : (
          list(waiting)
        )}
      </section>

      {signed.length > 0 ? (
        <section aria-labelledby="signed" className="space-y-3">
          <h2 id="signed" className="text-[15px] font-semibold">
            Signed by you
          </h2>
          {list(signed)}
        </section>
      ) : null}

      {session.isAdmin ? (
        <section aria-labelledby="all-documents" className="space-y-3">
          <h2 id="all-documents" className="text-[15px] font-semibold">
            All documents sent for signature
          </h2>
          {rows.length === 0 ? (
            <p className="meta">None yet. Use Send a PDF for signature to start.</p>
          ) : (
            <DataTable minWidth="560px">
              <TableHead>
                <TableHeader>Document</TableHeader>
                <TableHeader>Sent</TableHeader>
                <TableHeader>Signed</TableHeader>
              </TableHead>
              <tbody>
                {rows.map((d) => {
                  const total = d.signing_document_signer.length;
                  const done = d.signature.length;
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Link href={`/signatures/${d.id}`} className="font-medium text-brand-fg hover:underline">
                          {d.title}
                        </Link>
                      </TableCell>
                      <TableCell>{formatInZone(d.created_at, session.timeZone, { dateStyle: "medium" })}</TableCell>
                      <TableCell>
                        <Badge tone={done >= total && total > 0 ? "success" : "warning"}>
                          {done} of {total}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </section>
      ) : null}
    </div>
  );
}
