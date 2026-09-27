"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/client";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { syncLanguageCookie } from "@/features/preferences/services/locale.commands";

/**
 * Brings this browser in line with the language saved on the profile: the
 * first sign-in on a new device, or a change made on another one. Requests
 * read only the cookie (see `getLocale`), so until this runs the page shows
 * the browser's language; it then re-renders once in the saved one. No saved
 * language means "follow the browser", so there is nothing to do.
 */
export function LocaleSync({ saved }: { saved: string | null | undefined }) {
  const locale = useLocale();
  const router = useRouter();
  const attempted = useRef<Locale | null>(null);
  const preferred = isLocale(saved) ? saved : null;

  useEffect(() => {
    if (!preferred || preferred === locale || attempted.current === preferred) return;
    attempted.current = preferred;
    void syncLanguageCookie(preferred).then((result) => {
      if (result.ok) router.refresh();
    });
  }, [preferred, locale, router]);

  return null;
}
