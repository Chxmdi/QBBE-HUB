import Link from "next/link";
import { SearchX } from "lucide-react";
import { QbbeLogo } from "@/components/layout/qbbe-logo";
import { getT } from "@/lib/i18n/server";

/**
 * Any address that matches no screen. Without this, Next.js showed its own
 * plain black "404" with no way back (staging audit M10). Screens inside the
 * workspace that call notFound() use (workspace)/not-found.tsx instead.
 */
export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-4 py-10 text-center">
      <QbbeLogo />
      <div className="card flex max-w-md flex-col items-center gap-3 p-8">
        <SearchX className="size-8 text-muted" aria-hidden />
        <h1 className="text-[18px] font-semibold">{t("errors.notFoundTitle")}</h1>
        <p className="text-[13.5px] text-muted">{t("errors.notFoundBody")}</p>
        <Link href="/" className="mt-2 text-[13.5px] font-medium text-brand-fg hover:underline">
          {t("common.backToHome")}
        </Link>
      </div>
    </main>
  );
}
