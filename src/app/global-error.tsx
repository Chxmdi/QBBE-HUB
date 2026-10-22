"use client";

import { useEffect, useState } from "react";
import { LOCALE_COOKIE, isLocale, localeFromAcceptLanguage, type Locale } from "@/lib/i18n/config";
import { translatorFor, type TranslateFn } from "@/lib/i18n/translator";
import { reportError } from "@/lib/observability";

/**
 * Last-resort boundary for errors in the root layout itself, which
 * src/app/error.tsx cannot catch. It replaces the whole document, so it has no
 * language provider or stylesheet: it reads the language from the cookie or
 * the browser, loads only that language's text (the browser never carries
 * both), and uses plain inline styles. The crash is reported like any other
 * boundary's.
 */
function pageLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie.split("; ").find((c) => c.startsWith(`${LOCALE_COOKIE}=`))?.split("=")[1];
  return isLocale(cookie) ? cookie : localeFromAcceptLanguage(navigator.languages?.join(","));
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale] = useState(pageLocale);
  const [t, setT] = useState<TranslateFn | null>(null);

  useEffect(() => {
    reportError(error, { digest: error.digest });
  }, [error]);

  useEffect(() => {
    const load = locale === "fr-CA"
      ? import("@/lib/i18n/messages/fr-CA").then((m) => m.frCA)
      : import("@/lib/i18n/messages/en").then((m) => m.en);
    void load.then((catalog) => setT(() => translatorFor(catalog))).catch(() => {});
  }, [locale]);

  return (
    <html lang={locale}>
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0, padding: 16, textAlign: "center" }}>
        {t ? (
          <main>
            <h1 style={{ fontSize: 18 }}>{t("errors.rootTitle")}</h1>
            <p style={{ maxWidth: 420, fontSize: 14 }}>
              {t("errors.rootBody")}
              {error.digest ? t("errors.reference", { digest: error.digest }) : ""}.
            </p>
            <button type="button" onClick={reset} style={{ fontSize: 14, padding: "6px 12px" }}>
              {t("common.tryAgain")}
            </button>
          </main>
        ) : null}
      </body>
    </html>
  );
}
