import { Checkbox, FieldHint, Input, Label } from "@/components/ui/input";
import { CONSENT_STATEMENT } from "@/features/forms/fields";

/**
 * Typed name plus explicit consent (#144 v1). The wording shown here is the
 * wording the database stores with the signature.
 */
export function SignatureFields({ idPrefix }: { idPrefix: string }) {
  return (
    <fieldset className="card space-y-3 border-brand/40 p-4">
      <legend className="px-1 text-[14px] font-semibold">Signature</legend>
      <div>
        <Label htmlFor={`${idPrefix}-signer`}>Type your full name to sign</Label>
        <Input id={`${idPrefix}-signer`} name="signerName" required maxLength={200} autoComplete="name" />
        <FieldHint>Your account, the time and a fingerprint of exactly what you signed are recorded.</FieldHint>
      </div>
      <label className="flex items-start gap-2 text-[13px]">
        <Checkbox name="consent" required className="mt-0.5" />
        <span>{CONSENT_STATEMENT}</span>
      </label>
    </fieldset>
  );
}
