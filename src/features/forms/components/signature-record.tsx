import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getFormatters, getT } from "@/lib/i18n/server";

export interface SignatureRow {
  id: string;
  signer_name: string;
  signer_email: string | null;
  signed_at: string;
  consent_statement: string;
  content_sha256: string;
}

/**
 * The signature record (#144 v1) and whether the signed content still
 * matches. `currentSha256` is recomputed from what is stored now: for a
 * submission by the database, for a PDF from its bytes.
 */
export async function SignatureRecord({
  signatures,
  currentSha256,
  timeZone,
}: {
  signatures: SignatureRow[];
  currentSha256: string | null;
  timeZone: string;
}) {
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  return (
    <section aria-labelledby="signature-record" className="card space-y-3 p-4">
      <h2 id="signature-record" className="text-[15px] font-semibold">
        {t("signatures.record.heading")}
      </h2>
      {signatures.length === 0 ? (
        <p className="meta">{t("signatures.record.notSigned")}</p>
      ) : (
        <ul className="space-y-3">
          {signatures.map((s) => {
            const verified = currentSha256 !== null && currentSha256 === s.content_sha256;
            return (
              <li key={s.id} className="rounded-(--radius-sm) border border-line p-3" data-testid="signature">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {t("signatures.record.signedBy", { name: s.signer_name })}
                    {s.signer_email ? <span className="meta"> ({s.signer_email})</span> : null}
                  </p>
                  {verified ? (
                    <Badge tone="success">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {t("signatures.record.unchanged")}
                    </Badge>
                  ) : (
                    <Badge tone="danger">
                      <XCircle className="size-3.5" aria-hidden />
                      {currentSha256 === null
                        ? t("signatures.record.couldNotVerify")
                        : t("signatures.record.mismatch")}
                    </Badge>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[10rem_1fr]">
                  <dt className="text-muted">{t("signatures.record.signedAt")}</dt>
                  <dd>
                    <time dateTime={s.signed_at}>{format.inZone(s.signed_at, timeZone, { dateStyle: "medium", timeStyle: "long" })}</time>
                  </dd>
                  <dt className="text-muted">{t("signatures.record.agreedTo")}</dt>
                  <dd>{s.consent_statement}</dd>
                  <dt className="text-muted">{t("signatures.record.shaSigned")}</dt>
                  <dd className="font-mono text-[12px] break-all">{s.content_sha256}</dd>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
      <p className="meta">
        {t("signatures.record.shaNow")}{" "}
        <span className="font-mono text-[12px] break-all">{currentSha256 ?? t("signatures.record.unavailable")}</span>
      </p>
    </section>
  );
}
