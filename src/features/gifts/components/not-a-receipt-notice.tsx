import { Info } from "lucide-react";
import { DISCLAIMER_EN, DISCLAIMER_FR } from "@/features/gifts/acknowledgement";

/**
 * Reminds whoever records or acknowledges gifts that QBBE issues thank-you
 * letters, never official tax receipts (#156).
 */
export function NotAReceiptNotice() {
  return (
    <div role="note" className="mb-6 flex gap-3 rounded-(--radius-md) border border-line bg-surface-soft px-4 py-3 text-[13.5px]">
      <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div>
        <p className="font-medium">QBBE is a nonprofit, not a registered charity. It cannot issue official tax receipts.</p>
        <p className="mt-1 text-muted">
          Every thank-you letter and annual statement says so in English and French: “{DISCLAIMER_EN}” / “
          <span lang="fr">{DISCLAIMER_FR}</span>”
        </p>
      </div>
    </div>
  );
}
