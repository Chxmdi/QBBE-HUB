import Link from "next/link";
import { SearchX } from "lucide-react";
import { getT } from "@/lib/i18n/server";

export default async function WorkspaceNotFound() {
  const t = await getT();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <SearchX className="size-8 text-muted" aria-hidden />
      <h1 className="text-[18px] font-semibold">
        {t("errors.notFoundTitle")}
      </h1>
      <p className="max-w-md text-[13.5px] text-muted">
        {t("errors.notFoundBody")}
      </p>
      <Link href="/" className="mt-2 text-[13.5px] font-medium text-brand-fg hover:underline">
        {t("common.backToHome")}
      </Link>
    </div>
  );
}
