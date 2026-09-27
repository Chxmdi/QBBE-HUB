import { Info } from "lucide-react";
import { DISCLAIMER_EN, DISCLAIMER_FR } from "@/features/gifts/acknowledgement";
import { getT } from "@/lib/i18n/server";

/**
 * Reminds whoever records or acknowledges gifts that QBBE issues thank-you
 * letters, never official tax receipts (#156).
 */
export async function NotAReceiptNotice() {
  const t = await getT();
  return (
    <div role="note" className="mb-6 flex gap-3 rounded-(--radius-md) border border-line bg-surface-soft px-4 py-3 text-[13.5px]">
      <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div>
        <p className="font-medium">{t("finance.gifts.notice.heading")}</p>
        <p className="mt-1 text-muted">
          {t("finance.gifts.notice.body")} “<span lang="en">{DISCLAIMER_EN}</span>” / “
          <span lang="fr">{DISCLAIMER_FR}</span>”
        </p>
      </div>
    </div>
  );
}
