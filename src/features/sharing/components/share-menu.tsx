"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/input";
import { useSharingT } from "../i18n/client";
import { changeGrant, removeGrant, shareWith, type ShareActionState } from "../services/share.commands";
import type { ShareEntry, PrincipalKind } from "../services/share";
import type { SharePanel } from "../services/share.queries";

const initial: ShareActionState = { ok: false, message: null };

function Status({ state }: { state: ShareActionState }) {
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

function Provenance({ entry }: { entry: ShareEntry }) {
  const t = useSharingT();
  if (!entry.inheritedFrom) {
    const label = !entry.mirrored
      ? t("direct")
      : entry.source === "space.default"
        ? t("sources.default")
        : entry.source === "space.owner_id"
          ? t("sources.owner")
          : t("fromTodaysRules");
    return <Badge tone="brand">{label}</Badge>;
  }
  const from = entry.inheritedFrom;
  return (
    <Badge>
      {from.name ? t("inheritedFrom", { kind: t(`kinds.${from.kind}`), name: from.name }) : t("inheritedHidden")}
    </Badge>
  );
}

function RoleSelect({ id, name, roles, defaultValue, label }: {
  id: string;
  name: string;
  roles: SharePanel["options"]["roles"];
  defaultValue?: string;
  label?: string;
}) {
  return (
    <Select id={id} name={name} defaultValue={defaultValue ?? ""} aria-label={label} required className="h-8.5 w-auto min-w-40">
      {defaultValue ? null : <option value="">—</option>}
      {roles.map((role) => (
        <option key={role.id} value={role.id}>
          {role.label}
        </option>
      ))}
    </Select>
  );
}

function EditGrant({ entry, roles }: { entry: ShareEntry; roles: SharePanel["options"]["roles"] }) {
  const t = useSharingT();
  const id = useId();
  const [changed, change, changing] = useActionState(changeGrant, initial);
  const [removed, remove, removing] = useActionState(removeGrant, initial);
  const known = roles.some((role) => role.id === entry.roleId);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <form action={change} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="grantId" value={entry.grantId} />
        <RoleSelect
          id={`${id}-role`}
          name="roleId"
          roles={known ? roles : [{ id: entry.roleId, label: entry.roleLabel }, ...roles]}
          defaultValue={entry.roleId}
          label={t("roleFor", { name: entry.principal.label })}
        />
        <Button type="submit" size="sm" variant="secondary" loading={changing}>
          {t("save")}
        </Button>
      </form>
      <form action={remove}>
        <input type="hidden" name="grantId" value={entry.grantId} />
        <Button type="submit" size="sm" variant="ghost" loading={removing}>
          {t("remove", { name: entry.principal.label })}
        </Button>
      </form>
      <Status state={removed.message ? removed : changed} />
    </div>
  );
}

function OverrideGrant({ entry, objectId, roles }: { entry: ShareEntry; objectId: string; roles: SharePanel["options"]["roles"] }) {
  const t = useSharingT();
  const id = useId();
  const [state, action, pending] = useActionState(shareWith, initial);
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] font-medium text-brand-fg">
        {t("overrideFor", { name: entry.principal.label })}
      </summary>
      <form action={action} className="mt-2 grid gap-2">
        <input type="hidden" name="objectId" value={objectId} />
        <input type="hidden" name="principalKind" value={entry.principal.kind} />
        <input type="hidden" name="principalId" value={entry.principal.id} />
        <input type="hidden" name="includeInside" value="on" />
        <p id={`${id}-help`} className="text-[12.5px] text-muted">
          {t("overrideHelp")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <RoleSelect id={`${id}-role`} name="roleId" roles={roles} label={t("roleFor", { name: entry.principal.label })} />
          <Button type="submit" size="sm" loading={pending} aria-describedby={`${id}-help`}>
            {t("add.submit")}
          </Button>
        </div>
        <Status state={state} />
      </form>
    </details>
  );
}

function AddGrant({ panel }: { panel: SharePanel }) {
  const t = useSharingT();
  const id = useId();
  const [kind, setKind] = useState<PrincipalKind>("person");
  const [state, action, pending] = useActionState(shareWith, initial);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  const choices: Record<PrincipalKind, SharePanel["options"]["people"]> = {
    person: panel.options.people,
    team: panel.options.teams,
    org_role: panel.options.orgRoles,
  };
  const kindLabel: Record<PrincipalKind, string> = { person: t("add.person"), team: t("add.team"), org_role: t("add.orgRole") };

  return (
    <form ref={form} action={action} aria-labelledby={`${id}-heading`} className="card grid gap-3 p-4">
      <h3 id={`${id}-heading`} className="text-[14.5px] font-semibold text-ink">
        {t("add.heading")}
      </h3>
      <input type="hidden" name="objectId" value={panel.target.id} />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-[13px] font-medium text-ink">{t("add.whoKind")}</legend>
        {(["person", "team", "org_role"] as const).map((value) => (
          <label key={value} className="flex items-center gap-1.5 text-[13.5px] text-ink">
            <input
              type="radio"
              name="principalKind"
              value={value}
              checked={kind === value}
              onChange={() => setKind(value)}
              className="h-4 w-4 accent-brand"
            />
            {kindLabel[value]}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={`${id}-who`} className="text-[13px] font-medium text-ink">
            {t("add.who")}
          </label>
          <Select id={`${id}-who`} name={`principal_${kind}`} required defaultValue="" key={kind}>
            <option value="">{t("add.none")}</option>
            {choices[kind].map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-role`} className="text-[13px] font-medium text-ink">
            {t("add.role")}
          </label>
          <RoleSelect id={`${id}-role`} name="roleId" roles={panel.options.roles} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-[13.5px] text-ink">
        <Checkbox name="includeInside" defaultChecked />
        {t("reach.label")}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {t("add.submit")}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

/**
 * The share menu for a space or page (M10f): who has access and where it
 * comes from, and, for someone allowed to share, the controls to add,
 * change, remove and override. Every control is a native form element with a
 * visible or accessible name, so it works by keyboard and screen reader.
 */
export function ShareMenu({ panel }: { panel: SharePanel }) {
  const t = useSharingT();
  const id = useId();
  const canEdit = panel.canShare && panel.shareable;
  return (
    <section aria-labelledby={`${id}-share`} className="grid gap-4">
      <h2 id={`${id}-share`} className="text-[15px] font-semibold text-ink">
        {t("heading", { name: panel.target.name ?? "" })}
      </h2>
      {canEdit ? <AddGrant panel={panel} /> : <p className="text-[13px] text-muted">{t("cannotShare")}</p>}
      <div>
        <h3 id={`${id}-list`} className="mb-2 text-[14px] font-semibold text-ink">
          {t("whoHasAccess")}
        </h3>
        <p className="mb-2 text-[12.5px] text-muted">{t("everyoneAdmins")}</p>
        {panel.entries.length === 0 ? (
          <p className="text-sm text-muted">{t("nobodyYet")}</p>
        ) : (
          <ul aria-labelledby={`${id}-list`} className="grid gap-2">
            {panel.entries.map((entry) => (
              <li key={entry.grantId} className="card p-3" data-grant-id={entry.grantId}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-ink">{entry.principal.label}</span>
                  <span className="text-[13px] text-muted">
                    {t(`principals.${entry.principal.kind}`)} · {entry.roleLabel} · {t(`reach.${entry.reach}`)}
                  </span>
                  <Provenance entry={entry} />
                </div>
                {entry.editable ? <EditGrant entry={entry} roles={panel.options.roles} /> : null}
                {canEdit && entry.inheritedFrom && !entry.mirrored ? (
                  <OverrideGrant entry={entry} objectId={panel.target.id} roles={panel.options.roles} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
