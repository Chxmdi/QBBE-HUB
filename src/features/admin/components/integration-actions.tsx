"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  connectVolunteerSystem,
  disconnectIntegration,
} from "@/features/admin/services/integration.commands";
import { Button } from "@/components/ui/button";

export function IntegrationActions({
  provider,
  connected,
  googleConfigured,
  vmsConfigured,
}: {
  provider: "gmail" | "google_calendar" | "volunteer_system" | "email";
  connected: boolean;
  googleConfigured: boolean;
  vmsConfigured: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (provider === "email") return;
    setBusy(true);
    setError(null);
    const result = await disconnectIntegration(provider);
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Disconnect failed.");
    else router.refresh();
  }

  async function connectVms() {
    setBusy(true);
    setError(null);
    const result = await connectVolunteerSystem();
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Connect failed.");
    else router.refresh();
  }

  if (provider === "email") {
    return (
      <p className="meta mt-2">
        {connected
          ? "Provider key is present. Delivery runs via the notification-email job."
          : "Transactional email is not live. Invites are recorded, not emailed. Local Mailpit is used when EMAIL_PROVIDER_API_KEY is unset."}
      </p>
    );
  }

  if (provider === "gmail" || provider === "google_calendar") {
    if (!googleConfigured && !connected) {
      return (
        <p className="meta mt-2">
          Google OAuth credentials are not set. Connect stays unavailable until
          GOOGLE_CLIENT_ID / SECRET / redirect URI exist.
        </p>
      );
    }
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {connected ? (
          <Button variant="secondary" onClick={disconnect} loading={busy}>
            Disconnect
          </Button>
        ) : (
          <a
            href={`/api/integrations/google/start?provider=${provider}`}
            className="inline-flex h-9 items-center rounded-(--radius-sm) bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-strong"
          >
            Connect
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
          Disconnect
        </Button>
      ) : (
        <Button onClick={connectVms} loading={busy} disabled={!vmsConfigured}>
          Connect
        </Button>
      )}
      {!vmsConfigured ? (
        <p className="meta">Set VMS_API_URL to enable Connect. Hub does not store a second volunteer database.</p>
      ) : null}
      {error ? <p className="text-[12.5px] text-danger-fg">{error}</p> : null}
    </div>
  );
}
