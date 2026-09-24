"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setReduceMotion } from "@/features/onboarding/services/onboarding.commands";

/** Settings control for the in-app reduced-motion preference (UI-009). */
export function ReduceMotionSetting({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section aria-labelledby="display-heading" className="mt-8">
      <h2 id="display-heading" className="section-heading">
        Display
      </h2>
      <div className="mt-3 flex items-start gap-3">
        <input
          id="reduce-motion"
          type="checkbox"
          className="mt-1 size-4 accent-(--color-brand)"
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
                setError(result.error ?? "Could not save the setting.");
                return;
              }
              router.refresh();
            });
          }}
        />
        <div>
          <label htmlFor="reduce-motion" className="text-[14px] font-medium">
            Reduce motion
          </label>
          <p id="reduce-motion-help" className="text-[13px] text-muted">
            Turns off animations and smooth scrolling in QBBE Hub, even if your
            device is not set to reduce motion.
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
