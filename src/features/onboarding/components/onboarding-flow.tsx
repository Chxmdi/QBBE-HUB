"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  BellRing,
  Check,
  Compass,
  Plug,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select, Checkbox } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { QbbeLogo } from "@/components/layout/qbbe-logo";
import { saveNotificationPreferences } from "@/features/notifications/services/preferences.commands";
import {
  completeOnboarding,
  saveOnboardingProfile,
} from "@/features/onboarding/services/onboarding.commands";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "profile", label: "onboarding.steps.profile", icon: UserRound },
  { id: "notifications", label: "onboarding.steps.notifications", icon: BellRing },
  { id: "integrations", label: "onboarding.steps.integrations", icon: Plug },
  { id: "tour", label: "onboarding.steps.tour", icon: Compass },
] as const;

/** Splits a translated sentence around one placeholder, for inline markup. */
function around(text: string): [string, string] {
  const [before = "", after = ""] = text.split("\u0000");
  return [before, after];
}

const TIMEZONES = [
  "America/Toronto",
  "America/Montreal",
  "America/Vancouver",
  "America/Halifax",
  "UTC",
];

/**
 * First-run onboarding (§10.18): 4 short steps. Every step past the profile
 * can be skipped — optional integrations never block the workspace.
 */
export function OnboardingFlow({
  initialName,
  initialTitle,
  role,
}: {
  initialName: string;
  initialTitle: string | null;
  role: string;
}) {
  const t = useT();
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setSaving(true);
    const result = await completeOnboarding();
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("onboarding.errors.finishFailed"));
      return;
    }
    toast(t("onboarding.welcomeToast", { name: initialName.split(" ")[0] }));
    router.push("/");
    router.refresh();
  }

  async function handleProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await saveOnboardingProfile({
      fullName: form.get("fullName"),
      title: (form.get("title") as string) || undefined,
      timezone: (form.get("timezone") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("onboarding.errors.profileFailed"));
      return;
    }
    setStep(1);
  }

  async function handleNotifications(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await saveNotificationPreferences({
      emailCritical: form.get("emailCritical") === "on",
      emailDigest: form.get("emailDigest") === "on",
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("onboarding.errors.prefsFailed"));
      return;
    }
    setStep(2);
  }

  const [accessBefore, accessAfter] = around(t("onboarding.accessLevel", { role: "\u0000" }));
  const [tourBefore, tourAfter] = around(t("onboarding.tourIntro", { shortcut: "\u0000" }));

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-8 flex justify-center">
        <span className="rounded-(--radius-md) bg-logo-ground px-4 py-3">
          <QbbeLogo />
        </span>
      </div>

      {/* Progress — visible, not gamified */}
      <ol className="mb-6 flex items-center justify-center gap-2" aria-label={t("onboarding.progress")}>
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <span
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-[12px] font-semibold",
                i < step
                  ? "bg-success text-white"
                  : i === step
                    ? "bg-brand text-white"
                    : "bg-surface-soft text-muted",
              )}
            >
              {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            {i < STEPS.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "h-px w-6",
                  i < step ? "bg-success" : "bg-line",
                )}
              />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="card p-6">
        <p className="eyebrow mb-1">
          {t("onboarding.stepOf", { step: step + 1, total: STEPS.length })}
        </p>
        <h1 className="mb-1 text-[22px] font-semibold tracking-[-0.01em]">
          {t(STEPS[step].label)}
        </h1>

        {step === 0 ? (
          <form onSubmit={handleProfile} className="mt-4 space-y-4">
            <p className="text-[13.5px] text-muted">
              {t("onboarding.profileIntro")}
            </p>
            <div>
              <Label htmlFor="onb-name">{t("onboarding.fullName")}</Label>
              <Input
                id="onb-name"
                name="fullName"
                required
                maxLength={120}
                defaultValue={initialName}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="onb-title">{t("onboarding.roleTitle")}</Label>
              <Input
                id="onb-title"
                name="title"
                maxLength={120}
                defaultValue={initialTitle ?? ""}
                placeholder={t("onboarding.rolePlaceholder")}
              />
              <FieldHint>
                {accessBefore}
                <strong>{role}</strong>
                {accessAfter}
              </FieldHint>
            </div>
            <div>
              <Label htmlFor="onb-tz">{t("onboarding.timeZone")}</Label>
              <Select id="onb-tz" name="timezone" defaultValue="America/Toronto">
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
              <FieldHint>{t("onboarding.timeZoneHint")}</FieldHint>
            </div>
            {error ? (
              <p role="alert" className="text-[13px] text-danger-fg">
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={saving} className="w-full">
              {t("onboarding.continue")} <ArrowRight className="size-4" aria-hidden />
            </Button>
          </form>
        ) : null}

        {step === 1 ? (
          <form onSubmit={handleNotifications} className="mt-4 space-y-4">
            <p className="text-[13.5px] text-muted">
              {t("onboarding.notificationsIntro")}
            </p>
            <label className="flex items-start gap-2.5 rounded-(--radius-sm) border border-line p-3 text-[13.5px]">
              <Checkbox
                name="emailCritical"
                defaultChecked className="mt-0.5"
              />
              <span>
                <span className="block font-medium">{t("onboarding.emailUrgent")}</span>
                <span className="text-muted">
                  {t("onboarding.emailUrgentHint")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 rounded-(--radius-sm) border border-line p-3 text-[13.5px]">
              <Checkbox
                name="emailDigest" className="mt-0.5"
              />
              <span>
                <span className="block font-medium">{t("onboarding.dailyDigest")}</span>
                <span className="text-muted">
                  {t("onboarding.dailyDigestHint")}
                </span>
              </span>
            </label>
            {error ? (
              <p role="alert" className="text-[13px] text-danger-fg">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep(2)}
                className="flex-1"
              >
                {t("onboarding.skip")}
              </Button>
              <Button type="submit" loading={saving} className="flex-1">
                {t("onboarding.continue")}
              </Button>
            </div>
          </form>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 space-y-4">
            <p className="text-[13.5px] text-muted">
              {t("onboarding.integrationsIntro")}
            </p>
            <div className="rounded-(--radius-sm) border border-line p-3">
              <p className="text-[13.5px] font-medium">{t("onboarding.googleTitle")}</p>
              <p className="mt-0.5 text-[13px] text-muted">
                {t("onboarding.googleBody")}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep(3)}
                className="flex-1"
              >
                {t("onboarding.skipForNow")}
              </Button>
              <Button onClick={() => setStep(3)} className="flex-1">
                {t("onboarding.continue")}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-4 space-y-4">
            <p className="text-[13.5px] text-muted">
              {tourBefore}
              <kbd className="rounded border border-line bg-surface-soft px-1.5 py-0.5 text-[11px]">
                ⌘K
              </kbd>
              {tourAfter}
            </p>
            <ul className="space-y-2 text-[13.5px]">
              <li className="flex gap-2">
                <span className="font-medium">{t("onboarding.tour.home")}</span>
                <span className="text-muted">{t("onboarding.tour.homeHint")}</span>
              </li>
              <li className="flex gap-2">
                <span className="font-medium">{t("onboarding.tour.myWork")}</span>
                <span className="text-muted">{t("onboarding.tour.myWorkHint")}</span>
              </li>
              <li className="flex gap-2">
                <span className="font-medium">{t("onboarding.tour.channels")}</span>
                <span className="text-muted">{t("onboarding.tour.channelsHint")}</span>
              </li>
              <li className="flex gap-2">
                <span className="font-medium">{t("onboarding.tour.announcements")}</span>
                <span className="text-muted">{t("onboarding.tour.announcementsHint")}</span>
              </li>
            </ul>
            {error ? (
              <p role="alert" className="text-[13px] text-danger-fg">
                {error}
              </p>
            ) : null}
            <Button onClick={finish} loading={saving} className="w-full">
              {t("onboarding.enter")} <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      {step > 0 ? (
        <button
          type="button"
          onClick={() => setStep((s) => s - 1)}
          className="mt-4 text-center text-[13px] text-muted hover:text-ink"
        >
          {t("onboarding.back")}
        </button>
      ) : null}
    </main>
  );
}
