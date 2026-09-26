import type { Metadata, Viewport } from "next";
import "@/design-system/styles/globals.css";
import { I18nProvider } from "@/lib/i18n/client";
import { htmlLang } from "@/lib/i18n/config";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: {
      default: "QBBE Hub",
      template: "%s · QBBE Hub",
    },
    description: t("meta.description"),
  };
}

export const viewport: Viewport = {
  // Browser chrome colour. A <meta> value cannot read CSS variables, so
  // these repeat --color-canvas for each theme (globals.css); keep in step.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fc" },
    { media: "(prefers-color-scheme: dark)", color: "#10172f" },
  ],
};

/** Applies the persisted theme before paint to avoid a flash. */
const themeScript = `
try {
  var t = localStorage.getItem('qbbe-theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The person's language decides `lang` for the whole document, so screen
  // readers pronounce French as French and the axe sweep sees the truth.
  const locale = await getLocale();
  return (
    <html lang={htmlLang(locale)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
