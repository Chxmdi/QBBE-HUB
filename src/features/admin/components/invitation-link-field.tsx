"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useFormatters, useT } from "@/lib/i18n/client";

/**
 * The invitation link, shown once after it is created (SEC-001). The
 * invitation keeps only its hash, so this is the administrator's one chance to
 * copy it; a lost link is replaced with "New link", which also cancels the old
 * one.
 */
export function InvitationLinkField({
  link,
  email,
  expiresAt,
  timeZone,
}: {
  link: string;
  email: string;
  expiresAt: string;
  /** The organization's, so the date matches the one in the email. */
  timeZone?: string;
}) {
  const t = useT();
  const format = useFormatters();
  const id = useId();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      const field = document.getElementById(`${id}-link`);
      if (field instanceof HTMLInputElement) field.select();
      setCopyState("failed");
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-link`}>{t("admin.invite.linkLabel")}</Label>
      <div className="flex gap-2">
        <Input
          id={`${id}-link`}
          readOnly
          value={link}
          aria-describedby={`${id}-help`}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 font-mono text-[12.5px]"
        />
        <Button type="button" variant="secondary" onClick={copy}>
          {t("admin.invite.copy")}
        </Button>
      </div>
      <p id={`${id}-help`} className="text-[12.5px] text-muted">
        {t("admin.invite.linkHelp", { email, date: format.date(expiresAt, timeZone) })}
      </p>
      <p aria-live="polite" className="text-[12.5px] text-muted">
        {copyState === "copied"
          ? t("admin.invite.copied")
          : copyState === "failed"
            ? t("admin.invite.copyFailed")
            : null}
      </p>
    </div>
  );
}
