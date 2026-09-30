"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/input";
import { useSpacesT } from "../i18n/client";
import { saveSignInRule, type RuleActionState } from "./actions";
import type { OrgRoleKey } from "./sign-in-rules";

const initial: RuleActionState = { ok: false, message: null };

/** One role's row: two-step sign-in and session length. */
export function SignInRuleForm({ role, requireMfa, hours }: { role: OrgRoleKey; requireMfa: boolean; hours: number | null }) {
  const t = useSpacesT();
  const id = useId();
  const locked = role === "owner" || role === "admin";
  const [state, action, pending] = useActionState(saveSignInRule, initial);
  return (
    <form action={action} className="card grid gap-2 p-3 sm:grid-cols-[10rem_1fr_12rem_auto] sm:items-end">
      <input type="hidden" name="role" value={role} />
      <p className="text-[14px] font-semibold text-ink" id={`${id}-role`}>
        {t(`orgRoles.${role}`)}
      </p>
      <label className="flex items-center gap-2 text-[13.5px] text-ink">
        <Checkbox name="requireMfa" defaultChecked={requireMfa} disabled={locked} aria-describedby={`${id}-role`} />
        {locked ? t("admin.rules.alwaysOn") : t("admin.rules.mfa")}
      </label>
      <div className="grid gap-1">
        <label htmlFor={`${id}-hours`} className="text-[12.5px] font-medium text-ink">
          {t("admin.rules.hours")}
        </label>
        <Input
          id={`${id}-hours`}
          name="hours"
          inputMode="numeric"
          pattern="[0-9]*"
          defaultValue={hours ?? ""}
          aria-describedby={`${id}-help ${id}-role`}
        />
        <span id={`${id}-help`} className="text-[12px] text-muted">
          {t("admin.rules.hoursHelp")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={pending} aria-describedby={`${id}-role`}>
          {t("admin.rules.save")}
        </Button>
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-[12.5px] text-success-fg" : "text-[12.5px] text-danger-fg"}>
          {state.message ?? ""}
        </p>
      </div>
    </form>
  );
}
