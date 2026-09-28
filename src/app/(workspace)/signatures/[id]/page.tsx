import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { OpenFileButton } from "@/features/forms/components/open-file-button";
import { SignDocumentForm } from "@/features/forms/components/sign-document-form";
import { SignatureRecord, type SignatureRow } from "@/features/forms/components/signature-record";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getFormatters, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("signatures.doc.metaTitle") };
}
export const dynamic = "force-dynamic";

type ScanStatus = "pending" | "clean" | "quarantined" | "rejected";

export default async function SigningDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createSupabasePageClient();
  const { data: doc } = await supabase
    .from("signing_document")
    .select("id, title, message, file_name, storage_path, scan_status, content_sha256, created_at, uploader:uploaded_by(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!doc) notFound();
  const document = doc as unknown as {
    id: string;
    title: string;
    message: string | null;
    file_name: string;
    storage_path: string;
    scan_status: ScanStatus;
    content_sha256: string | null;
    created_at: string;
    uploader: { full_name: string } | null;
  };

  const [t, format] = await Promise.all([getT(), getFormatters()]);
  const [{ data: signers }, { data: signatures }] = await Promise.all([
    supabase
      .from("signing_document_signer")
      .select("user_id, user_profile:user_id(full_name)")
      .eq("document_id", id),
    supabase
      .from("signature")
      .select("id, signer_id, signer_name, signer_email, signed_at, consent_statement, content_sha256")
      .eq("signing_document_id", id)
      .order("signed_at"),
  ]);
  const signatureRows = (signatures ?? []) as (SignatureRow & { signer_id: string })[];
  const signerRows = (signers ?? []) as unknown as { user_id: string; user_profile: { full_name: string } | null }[];
  const askedToSign = signerRows.some((s) => s.user_id === session.userId);
  const hasSigned = signatureRows.some((s) => s.signer_id === session.userId);

  // Verification: hash the bytes as they are stored now and compare them with
  // what each signature covers. Read through the caller's own client, so this
  // works only for people allowed to open the file.
  let currentSha256: string | null = null;
  if (document.scan_status === "clean") {
    const { data: file } = await supabase.storage.from("signing-documents").download(document.storage_path);
    if (file) currentSha256 = createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest("hex");
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={[{ label: t("signatures.title"), href: "/signatures" }, { label: document.title }]} />
        <PageHeader
          eyebrow={t("signatures.doc.eyebrow")}
          title={document.title}
          description={t("signatures.doc.description", {
            name: document.uploader?.full_name ?? t("signatures.doc.anAdmin"),
            date: format.inZone(document.created_at, session.timeZone, { dateStyle: "long" }),
          })}
        />
      </div>
      {document.message ? <p className="max-w-2xl text-[14px] whitespace-pre-wrap">{document.message}</p> : null}

      <section aria-labelledby="the-document" className="card space-y-2 p-4">
        <h2 id="the-document" className="text-[15px] font-semibold">
          {t("signatures.doc.theDocument")}
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-[14px]">
          {document.file_name}
          <OpenFileButton kind="signing-document" id={document.id} fileName={document.file_name} scanStatus={document.scan_status} />
        </p>
        <p className="meta">
          {t("signatures.doc.shaChecked")}{" "}
          <span className="font-mono text-[12px] break-all">{document.content_sha256 ?? t("signatures.doc.notRecorded")}</span>
        </p>
      </section>

      {session.isAdmin && signerRows.length > 0 ? (
        <section aria-labelledby="signers" className="card p-4">
          <h2 id="signers" className="mb-2 text-[15px] font-semibold">
            {t("signatures.doc.signers")}
          </h2>
          <ul className="space-y-1 text-[14px]">
            {signerRows.map((s) => (
              <li key={s.user_id} className="flex items-center gap-2">
                {s.user_profile?.full_name ?? t("signatures.member")}
                {signatureRows.some((sig) => sig.signer_id === s.user_id) ? (
                  <Badge tone="success">{t("signatures.doc.signed")}</Badge>
                ) : (
                  <Badge tone="warning">{t("signatures.doc.waiting")}</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {askedToSign && !hasSigned ? (
        document.scan_status === "clean" && document.content_sha256 ? (
          <section aria-labelledby="sign-here" className="space-y-2">
            <h2 id="sign-here" className="text-[15px] font-semibold">
              {t("signatures.doc.yourSignature")}
            </h2>
            <p className="meta max-w-2xl">{t("signatures.doc.readFirst")}</p>
            <SignDocumentForm documentId={document.id} />
          </section>
        ) : (
          <p className="meta">{t("signatures.doc.afterCheck")}</p>
        )
      ) : null}

      <SignatureRecord signatures={signatureRows} currentSha256={currentSha256} timeZone={session.timeZone} />
    </div>
  );
}
