import { Badge } from "@/components/ui/badge";
import type { Locale } from "@/lib/i18n/config";
import type { SpacesT } from "../i18n";
import { spaceName, type Space } from "../services/spaces";

/** One group of spaces, as a labelled list. Server component. */
export function SpaceList({
  id,
  heading,
  spaces,
  empty,
  locale,
  t,
}: {
  id: string;
  heading: string;
  spaces: Space[];
  empty: string;
  locale: Locale;
  t: SpacesT;
}) {
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className="mb-3 text-[15px] font-semibold text-ink">
        {heading}
      </h2>
      {spaces.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {spaces.map((space) => (
            <li key={space.id} className="card p-4" data-space-id={space.id}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14.5px] font-semibold text-ink">{spaceName(space, locale)}</h3>
                <Badge tone={space.kind === "private" ? "accent" : "neutral"}>{t(`kinds.${space.kind}`)}</Badge>
                {space.archivedAt ? <Badge tone="warning">{t("archived")}</Badge> : null}
              </div>
              {space.description ? (
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{space.description}</p>
              ) : null}
              <p className="mt-2 text-[12.5px] text-muted">
                {space.capabilities.length === 0 ? (
                  t("nothingYet")
                ) : (
                  <>
                    <span className="font-medium text-ink">{t("youCan")}</span>{" "}
                    {space.capabilities.map((capability) => t(`capabilities.${capability}`)).join(", ")}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
