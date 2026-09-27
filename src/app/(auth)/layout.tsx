import { QbbeLogo } from "@/components/layout/qbbe-logo";
import { LanguageToggle } from "@/features/preferences/components/language-switcher";
import { getLocale, getT } from "@/lib/i18n/server";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_12%,rgb(70_94_180_/_0.10),transparent_36%),radial-gradient(circle_at_86%_88%,rgb(232_179_109_/_0.12),transparent_34%)]"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-6 overflow-hidden rounded-(--radius-lg) border border-brand/15 bg-brand p-4 shadow-(--shadow-pop)">
          <QbbeLogo />
          <div className="qbbe-brand-rule mt-3" aria-hidden />
          <p className="mt-2 text-[11px] font-semibold tracking-[0.05em] text-white/72">
            {t("common.internalWorkspace").toUpperCase()}
          </p>
        </div>
        <div className="mb-5 text-center">
          <h1 className="page-title text-[26px] md:text-[30px]">QBBE Hub</h1>
          <p className="mt-2 text-[13.5px] text-muted">
            {t("auth.tagline")}
          </p>
        </div>
        {children}
        <div className="mt-5">
          <LanguageToggle current={locale} />
        </div>
      </div>
    </main>
  );
}
