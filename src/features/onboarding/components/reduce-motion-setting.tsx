"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/input";
import { setReduceMotion } from "@/features/onboarding/services/onboarding.commands";
import { useT } from "@/lib/i18n/client";

/** Settings control for the in-app reduced-motion preference (UI-009). */
export function ReduceMotionSetting({ initial }: { initial: boolean }) {
  const t = useT();
  const router = useRouter();
  const [checked, setChecked] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section aria-labelledby="display-heading" className="mt-8">
      <h2 id="display-heading" className="section-heading">
        {t("settings.display.heading")}
      </h2>
      <div className="mt-3 flex items-start gap-3">
        <Checkbox
          id="reduce-motion"
          className="mt-1"
          checked={checked}
          disabled={pending}
          aria-describedby="reduce-motion-help"
          onChange={(e) => {
            const next = e.target.checked;
            setChecked(next);
            setError(null);
            startTransition(async () => {
              const result = await setReduceMotion(next);
              if (!result.ok) {
                setChecked(!next);
                setError(result.error ?? t("settings.display.saveFailed"));
                return;
              }
              router.refresh();
            });
          }}
        />
        <div>
          <label htmlFor="reduce-motion" className="text-[14px] font-medium">
            {t("settings.display.reduceMotion")}
          </label>
          <p id="reduce-motion-help" className="text-[13px] text-muted">
            {t("settings.display.reduceMotionHelp")}
          </p>
          {error ? (
            <p role="alert" className="mt-1 text-[12.5px] text-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
