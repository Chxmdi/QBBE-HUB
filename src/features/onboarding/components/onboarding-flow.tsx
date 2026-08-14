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
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { QbbeLogo } from "@/components/layout/qbbe-logo";
import {
  completeOnboarding,
  saveNotificationPreferences,
  saveOnboardingProfile,
} from "@/features/onboarding/services/onboarding.commands";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "profile", label: "Your profile", icon: UserRound },
  { id: "notifications", label: "Notifications", icon: BellRing },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "tour", label: "Get oriented", icon: Compass },
] as const;

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
      setError(result.error ?? "Could not finish setup.");
      return;
    }
    toast(`Welcome to QBBE Hub, ${initialName.split(" ")[0]}.`);
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
      setError(result.error ?? "Could not save your profile.");
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
      setError(result.error ?? "Could not save preferences.");
      return;
    }
    setStep(2);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-8 flex justify-center">
        <span className="rounded-(--radius-md) bg-[#221219] px-4 py-3">
          <QbbeLogo />
        </span>
      </div>

      {/* Progress — visible, not gamified */}
      <ol className="mb-6 flex items-center justify-center gap-2" aria-label="Setup progress">
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
          Step {step + 1} of {STEPS.length}
        </p>
        <h1 className="mb-1 text-[22px] font-semibold tracking-[-0.01em]">
          {STEPS[step].label}
        </h1>

        {step === 0 ? (
          <form onSubmit={handleProfile} className="mt-4 space-y-4">
            <p className="text-[13.5px] text-muted">
              Your name and role appear beside your work, messages, and
              approvals across the Hub.
            </p>
            <div>
              <Label htmlFor="onb-name">Full name</Label>
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
              <Label htmlFor="onb-title">Role or title</Label>
              <Input
                id="onb-title"
                name="title"
                maxLength={120}
                defaultValue={initialTitle ?? ""}
                placeholder="e.g. Program Coordinator"
              />
              <FieldHint>
                Your access level is <strong>{role}</strong> — only an
                administrator can change that.
              </FieldHint>
            </div>
            <div>
              <Label htmlFor="onb-tz">Time zone</Label>
              <Select id="onb-tz" name="timezone" defaultValue="America/Toronto">
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
              <FieldHint>Due dates and meeting times display in this zone.</FieldHint>
            </div>
            {error ? (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={saving} className="w-full">
              Continue <ArrowRight className="size-4" aria-hidden />
            </Button>
          </form>
        ) : null}

        {step === 1 ? (
          <form onSubmit={handleNotifications} className="mt-4 space-y-4">
            <p className="text-[13.5px] text-muted">
              You can change these any time. Critical security notices and
              required announcements are always delivered.
            </p>
            <label className="flex items-start gap-2.5 rounded-(--radius-sm) border border-line p-3 text-[13.5px]">
              <input
                type="checkbox"
                name="emailCritical"
                defaultChecked
                className="mt-0.5 size-4 accent-(--color-brand)"
              />
              <span>
                <span className="block font-medium">Email me urgent items</span>
                <span className="text-muted">
                  Direct assignments, mentions, and critical announcements.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 rounded-(--radius-sm) border border-line p-3 text-[13.5px]">
              <input
                type="checkbox"
                name="emailDigest"
                className="mt-0.5 size-4 accent-(--color-brand)"
              />
              <span>
                <span className="block font-medium">Send a daily digest</span>
                <span className="text-muted">
                  Group routine activity into one summary instead of separate
                  emails.
                </span>
              </span>
            </label>
            {error ? (
              <p role="alert" className="text-[13px] text-danger">
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
                Skip
              </Button>
              <Button type="submit" loading={saving} className="flex-1">
                Continue
              </Button>
            </div>
          </form>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 space-y-4">
            <p className="text-[13.5px] text-muted">
              Gmail and Google Calendar connect the Hub to your mailbox and
              schedule. These are optional and can be set up later by an
              administrator.
            </p>
            <div className="rounded-(--radius-sm) border border-line p-3">
              <p className="text-[13.5px] font-medium">Gmail & Google Calendar</p>
              <p className="mt-0.5 text-[13px] text-muted">
                Requires QBBE-approved Google credentials. Until an
                administrator configures them, these stay disconnected — the
                Hub works fully without them.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep(3)}
                className="flex-1"
              >
                Skip for now
              </Button>
              <Button onClick={() => setStep(3)} className="flex-1">
                Continue
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-4 space-y-4">
            <p className="text-[13.5px] text-muted">
              Here&apos;s where things live. You can always press{" "}
              <kbd className="rounded border border-line bg-surface-soft px-1.5 py-0.5 text-[11px]">
                ⌘K
              </kbd>{" "}
              to search or jump anywhere.
            </p>
            <ul className="space-y-2 text-[13.5px]">
              <li className="flex gap-2">
                <span className="font-medium">Home</span>
                <span className="text-muted">
                  — what needs attention today, and portfolio health.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-medium">My Work</span>
                <span className="text-muted">
                  — everything assigned to you, grouped by urgency.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-medium">Channels</span>
                <span className="text-muted">
                  — team conversation that stays close to the work.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-medium">Announcements</span>
                <span className="text-muted">
                  — official notices; some need your acknowledgment.
                </span>
              </li>
            </ul>
            {error ? (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <Button onClick={finish} loading={saving} className="w-full">
              Enter the workspace <ArrowRight className="size-4" aria-hidden />
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
          ← Back
        </button>
      ) : null}
    </main>
  );
}
