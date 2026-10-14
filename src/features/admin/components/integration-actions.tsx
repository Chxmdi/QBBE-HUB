"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  connectVolunteerSystem,
  connectZeffy,
  disconnectIntegration,
  syncZeffyNow,
} from "@/features/admin/services/integration.commands";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

export function IntegrationActions({
  provider,
  connected,
  status,
  googleConfigured,
  vmsConfigured,
  zeffyConfigured = false,
}: {
  provider: "gmail" | "google_calendar" | "google_drive" | "volunteer_system" | "zeffy" | "email";
  connected: boolean;
  status?: string | null;
  googleConfigured: boolean;
  vmsConfigured: boolean;
  zeffyConfigured?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"connect" | "sync" | "disconnect" | null>(null);

  async function runZeffy(action: "connect" | "sync" | "disconnect") {
    setBusyAction(action);
    setError(null);
    setNotice(null);
    const result =
      action === "connect"
        ? await connectZeffy()
        : action === "sync"
          ? await syncZeffyNow()
          : await disconnectIntegration("zeffy");
    setBusyAction(null);
    if (!result.ok) {
      setError(
        result.error ??
          t(
            action === "sync"
              ? "admin.workspace.integrations.actions.syncFailed"
              : action === "connect"
                ? "admin.workspace.integrations.actions.connectFailed"
                : "admin.workspace.integrations.actions.disconnectFailed",
          ),
      );
      return;
    }
    if (action !== "disconnect") setNotice(t("admin.workspace.integrations.actions.syncStarted"));
    router.refresh();
  }

  async function disconnect() {
    if (provider === "email") return;
    setBusy(true);
    setError(null);
    const result = await disconnectIntegration(provider);
    setBusy(false);
    if (!result.ok) setError(result.error ?? t("admin.workspace.integrations.actions.disconnectFailed"));
    else router.refresh();
  }

  async function connectVms() {
    setBusy(true);
    setError(null);
    const result = await connectVolunteerSystem();
    setBusy(false);
    if (!result.ok) setError(result.error ?? t("admin.workspace.integrations.actions.connectFailed"));
    else router.refresh();
  }

  if (provider === "email") {
    return (
      <p className="meta mt-2">
        {connected
          ? t("admin.workspace.integrations.actions.emailConfigured")
          : t("admin.workspace.integrations.actions.emailNotConfigured")}
      </p>
    );
  }

  if (provider === "zeffy") {
    // Any recorded state but "disconnected" is a connection an admin manages:
    // a delayed or degraded one can still sync; an expired key reconnects.
    const linked = Boolean(status) && status !== "disconnected";
    const needsKey = status === "authentication_expired" || status === "configuration_required";
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {linked ? (
          <>
            {needsKey ? (
              <Button onClick={() => runZeffy("connect")} loading={busyAction === "connect"} disabled={!zeffyConfigured}>
                {t("admin.workspace.integrations.actions.reauthenticate")}
              </Button>
            ) : (
              <Button onClick={() => runZeffy("sync")} loading={busyAction === "sync"} disabled={!zeffyConfigured}>
                {t("admin.workspace.integrations.actions.syncNow")}
              </Button>
            )}
            <Button variant="secondary" onClick={() => runZeffy("disconnect")} loading={busyAction === "disconnect"}>
              {t("admin.workspace.integrations.actions.disconnect")}
            </Button>
          </>
        ) : (
          <Button onClick={() => runZeffy("connect")} loading={busyAction === "connect"} disabled={!zeffyConfigured}>
            {t("admin.workspace.integrations.actions.connect")}
          </Button>
        )}
        {!zeffyConfigured ? (
          <p className="meta">{t("admin.workspace.integrations.actions.zeffyNotConfigured")}</p>
        ) : null}
        {notice ? <p role="status" className="meta">{notice}</p> : null}
        {error ? <p role="alert" className="text-[12.5px] text-danger-fg">{error}</p> : null}
      </div>
    );
  }

  if (provider === "gmail" || provider === "google_calendar" || provider === "google_drive") {
    if (!googleConfigured && !connected) {
      return (
        <p className="meta mt-2">
          {t("admin.workspace.integrations.actions.googleNotConfigured")}
        </p>
      );
    }
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {connected ? (
          <Button variant="secondary" onClick={disconnect} loading={busy}>
            {t("admin.workspace.integrations.actions.disconnect")}
          </Button>
        ) : (
          <a
            href={`/api/integrations/google/start?provider=${provider}`}
            className="inline-flex h-9 items-center rounded-(--radius-sm) bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-strong"
          >
            {status === "authentication_expired"
              ? t("admin.workspace.integrations.actions.reauthenticate")
              : t("admin.workspace.integrations.actions.connect")}
          </a>
        )}
        {error ? <p className="text-[12.5px] text-danger-fg">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {connected ? (
        <Button variant="secondary" onClick={disconnect} loading={busy}>
          {t("admin.workspace.integrations.actions.disconnect")}
        </Button>
      ) : (
        <Button onClick={connectVms} loading={busy} disabled={!vmsConfigured}>
          {t("admin.workspace.integrations.actions.connect")}
        </Button>
      )}
      {!vmsConfigured ? (
        <p className="meta">{t("admin.workspace.integrations.actions.vmsNotConfigured")}</p>
      ) : null}
      {error ? <p className="text-[12.5px] text-danger-fg">{error}</p> : null}
    </div>
  );
}
