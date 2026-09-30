"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceCapabilities } from "@/lib/objects/contracts";
import { useSpacesT } from "../i18n/client";
import { createRole, deleteRole, updateRole } from "../services/roles.commands";
import type { AccessRole } from "../services/roles";
import type { SpaceActionState } from "../services/spaces.commands";

const initial: SpaceActionState = { ok: false, message: null };

function Message({ state }: { state: SpaceActionState }) {
  return (
    <p
      role={state.ok ? "status" : "alert"}
      aria-live={state.ok ? "polite" : "assertive"}
      className={state.ok ? "text-[13px] text-success-fg" : "text-[13px] text-danger-fg"}
    >
      {state.message ?? ""}
    </p>
  );
}

/** Create a role, or edit a custom one. Checkboxes in a labelled group. */
export function RoleForm({ role }: { role?: AccessRole }) {
  const t = useSpacesT();
  const id = useId();
  const [state, action, pending] = useActionState(role ? updateRole : createRole, initial);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && !role) form.current?.reset();
  }, [state, role]);

  return (
    <form ref={form} action={action} className="grid gap-3">
      {role ? <input type="hidden" name="roleId" value={role.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={`${id}-en`} className="text-[13px] font-medium text-ink">
            {t("roles.nameEn")}
          </label>
          <Input id={`${id}-en`} name="nameEn" required maxLength={80} defaultValue={role?.name.en} autoComplete="off" />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-fr`} className="text-[13px] font-medium text-ink">
            {t("roles.nameFr")}
          </label>
          <Input
            id={`${id}-fr`}
            name="nameFr"
            lang="fr-CA"
            required
            maxLength={80}
            defaultValue={role?.name.fr}
            autoComplete="off"
          />
        </div>
      </div>
      <fieldset className="grid gap-1.5" aria-describedby={`${id}-help`}>
        <legend className="text-[13px] font-medium text-ink">{t("roles.capabilitiesLabel")}</legend>
        <p id={`${id}-help`} className="text-[12.5px] text-muted">
          {t("roles.capabilitiesHelp")}
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {workspaceCapabilities.map((capability) => (
            <label key={capability} className="flex items-center gap-2 text-[13.5px] text-ink">
              <input
                type="checkbox"
                name="capabilities"
                value={capability}
                defaultChecked={role ? role.capabilities.includes(capability) : capability === "view"}
                className="h-4 w-4 accent-brand"
              />
              {t(`capabilities.${capability}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {pending ? t("roles.saving") : role ? t("roles.submitSave") : t("roles.submitCreate")}
        </Button>
        <Message state={state} />
      </div>
    </form>
  );
}

export function DeleteRoleButton({ role, label }: { role: AccessRole; label: string }) {
  const [state, action, pending] = useActionState(deleteRole, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="roleId" value={role.id} />
      <Button type="submit" variant="danger" size="sm" loading={pending}>
        {label}
      </Button>
      <Message state={state} />
    </form>
  );
}
