import type { Metadata } from "next";
import Link from "next/link";
import { QbbeLogo } from "@/components/layout/qbbe-logo";
import { LanguageToggle } from "@/features/preferences/components/language-switcher";
import {
  PRIVACY_NOTICE_IS_DRAFT,
  PRIVACY_NOTICE_VERSION,
  PRIVACY_PERSON_IN_CHARGE,
} from "@/config/privacy";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("privacy.title") };
}

/**
 * The privacy notice (Law 25, s. 8 and s. 3.2), readable without signing in:
 * it has to be available before anyone gives the Hub their information. The
 * text is in the catalogues (`privacy.*`); src/config/privacy.ts holds the
 * version, whether it is still a draft, and the person in charge.
 */
export default async function PrivacyPage() {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const sections = [
    ["privacy.collectHeading", "privacy.collectBody"],
    ["privacy.whyHeading", "privacy.whyBody"],
    ["privacy.whoHeading", "privacy.whoBody"],
    ["privacy.staffHeading", "privacy.staffBody"],
    ["privacy.whereHeading", "privacy.whereBody"],
    ["privacy.keepHeading", "privacy.keepBody"],
    ["privacy.rightsHeading", "privacy.rightsBody"],
  ] as const;
  const person = PRIVACY_PERSON_IN_CHARGE;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 overflow-hidden rounded-(--radius-lg) border border-brand/15 bg-brand p-4">
        <QbbeLogo />
      </div>
      <h1 className="page-title text-[26px]">{t("privacy.title")}</h1>
      <p className="meta mt-1">{t("privacy.version", { version: PRIVACY_NOTICE_VERSION })}</p>
      {PRIVACY_NOTICE_IS_DRAFT ? (
        <p
          role="note"
          className="mt-4 rounded-(--radius-sm) border border-warning/30 bg-warning/10 px-3 py-2 text-[13.5px] text-warning-fg"
        >
          {t("privacy.draftBanner")}
        </p>
      ) : null}
      <p className="mt-5 text-[14.5px] leading-relaxed">{t("privacy.intro")}</p>
      {sections.map(([heading, body]) => (
        <section key={heading} className="mt-6">
          <h2 className="section-heading">{t(heading)}</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed">{t(body)}</p>
        </section>
      ))}
      <section className="mt-6">
        <h2 className="section-heading">{t("privacy.contactHeading")}</h2>
        <p className="mt-2 text-[14.5px] leading-relaxed">
          {person.title && person.email
            ? t("privacy.contactNamed", { title: person.title, email: person.email })
            : t("privacy.contactPending")}
        </p>
      </section>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Link href="/sign-in" className="text-[13.5px] font-medium text-brand-fg hover:underline">
          {t("privacy.backToSignIn")}
        </Link>
        <LanguageToggle current={locale} />
      </div>
    </main>
  );
}
