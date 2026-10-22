import { AlertTriangle } from "lucide-react";
import type { TranslateFn } from "@/lib/i18n/translator";

/**
 * Supabase has no backup codes, so an owner or admin with a single
 * authenticator who loses it is locked out until someone runs the
 * break-glass reset (docs/runbooks/account-recovery.md). A second
 * authenticator avoids that; owners and admins with fewer than two are asked
 * to add one.
 */
export function needsSecondFactor(isAdmin: boolean, verifiedFactors: number): boolean {
  return isAdmin && verifiedFactors < 2;
}

export function SecondFactorReminder({ t }: { t: TranslateFn }) {
  return (
    <div role="note" className="mt-4 flex gap-2.5 rounded-(--radius-sm) border border-warning/40 bg-warning/8 px-3.5 py-3 text-[13.5px]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden />
      <div>
        <p className="font-semibold">{t("settings.mfa.secondFactorTitle")}</p>
        <p className="text-muted">{t("settings.mfa.secondFactorBody")}</p>
      </div>
    </div>
  );
}
