"use client";

import { Checkbox, FieldHint, Input, Label } from "@/components/ui/input";
import { CONSENT_STATEMENT } from "@/features/forms/fields";
import { useLocale, useT } from "@/lib/i18n/client";

/**
 * Typed name plus explicit consent (#144 v1). The wording shown next to the
 * checkbox is the wording the database stores with the signature, so it stays
 * in English until app.signature_consent_statement() has a French version; in
 * French a translation is shown underneath as an aid.
 */
export function SignatureFields({ idPrefix }: { idPrefix: string }) {
  const t = useT();
  const translation = useLocale() === "en" ? null : t("signatures.fields.consentTranslation");
  return (
    <fieldset className="card space-y-3 border-brand/40 p-4">
      <legend className="px-1 text-[14px] font-semibold">{t("signatures.fields.legend")}</legend>
      <div>
        <Label htmlFor={`${idPrefix}-signer`}>{t("signatures.fields.typeName")}</Label>
        <Input id={`${idPrefix}-signer`} name="signerName" required maxLength={200} autoComplete="name" />
        <FieldHint>{t("signatures.fields.typeNameHint")}</FieldHint>
      </div>
      <label className="flex items-start gap-2 text-[13px]">
        <Checkbox name="consent" required className="mt-0.5" />
        <span lang="en">{CONSENT_STATEMENT}</span>
      </label>
      {translation ? <p className="meta">{translation}</p> : null}
    </fieldset>
  );
}
