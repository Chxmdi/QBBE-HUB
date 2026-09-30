"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { usePathname } from "next/navigation";

type PhoneMessage = { ok: boolean; text: string } | null;

const PhoneStatusContext = createContext<((message: PhoneMessage) => void) | null>(null);

/**
 * The phone screens' confirmation line. It lives in the layout, not in the
 * list that raised it, so "Marked done." stays readable (and announced) after
 * the refresh empties that list or removes its section.
 */
export function PhoneStatusProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [shown, setShown] = useState<{ message: PhoneMessage; path: string }>({ message: null, path: pathname });
  const show = useCallback((next: PhoneMessage) => setShown({ message: next, path: pathname }), [pathname]);
  // A message belongs to the screen that raised it.
  const message = shown.path === pathname ? shown.message : null;
  return (
    <PhoneStatusContext.Provider value={show}>
      <p role="status" className="mb-3 text-[12.5px] text-success-fg empty:hidden">
        {message?.ok ? message.text : null}
      </p>
      {message && !message.ok ? (
        <p role="alert" className="mb-3 text-[12.5px] text-danger-fg">
          {message.text}
        </p>
      ) : null}
      {children}
    </PhoneStatusContext.Provider>
  );
}

/** Shows a confirmation or error on the phone screens; null outside them. */
export function usePhoneStatus() {
  return useContext(PhoneStatusContext);
}
