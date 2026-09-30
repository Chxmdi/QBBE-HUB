import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { universalTasksT } from "../i18n";
import type { ResolvedTaskSource } from "../source.queries";

/**
 * "From meeting: Board review" under a task, linking back to its source
 * (M7b). Server component; the task drawer mounts it at integration.
 */
export function TaskSourceLink({
  source,
  locale,
}: {
  source: ResolvedTaskSource | null;
  locale: Locale;
}) {
  if (!source || source.type === "manual") return null;
  const t = universalTasksT(locale);
  const kind = t(`source.kind.${source.type}`);
  if (!source.readable) {
    return <p className="text-sm text-muted">{t("source.unavailable", { kind })}</p>;
  }
  const text = source.title ? t("source.fromNamed", { kind, title: source.title }) : t("source.from", { kind });
  return (
    <p className="text-sm text-muted">
      {source.href ? (
        <Link href={source.href} className="text-brand-fg underline hover:no-underline">
          {text}
        </Link>
      ) : (
        text
      )}
    </p>
  );
}
