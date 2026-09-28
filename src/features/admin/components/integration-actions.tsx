"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  connectVolunteerSystem,
  disconnectIntegration,
} from "@/features/admin/services/integration.commands";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

export function IntegrationActions({
  provider,
  connected,
  status,
  googleConfigured,
  vmsConfigured,
}: {
  provider: "gmail" | "google_calendar" | "google_drive" | "volunteer_system" | "email";
  connected: boolean;
  status?: string | null;
  googleConfigured: boolean;
  vmsConfigured: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
