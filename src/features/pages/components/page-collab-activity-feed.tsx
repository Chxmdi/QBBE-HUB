import { getLocale } from "@/lib/i18n/server";
import { createPagesT } from "@/features/pages/i18n";
import { ActivityPanel, type ActivityLabels } from "./page-collab-activity";

async function activityLabels(kind: "page" | "record"): Promise<ActivityLabels> {
  const t = createPagesT(await getLocale());
  return {
    listLabel: t("units.c2.listLabel"),
    empty: t(kind === "page" ? "units.c2.emptyPage" : "units.c2.emptyRecord"),
    error: t("units.c2.error"),
    retry: t("units.c2.retry"),
    showOlder: t("units.c2.showOlder"),
    loadingOlder: t("units.c2.loadingOlder"),
    olderError: t("units.c2.olderError"),
    end: t("units.c2.end"),
    loading: t("units.c2.loading"),
  };
}

/**
 * Wave 2 C2: an object's activity panel with its words in the reader's
 * language. The entries themselves are read by the panel, as the viewer.
 * The caller decides whether the unit's switches are on.
 */
export async function ActivityFeed({ objectId, kind }: { objectId: string; kind: "page" | "record" }) {
  return <ActivityPanel key={objectId} objectId={objectId} labels={await activityLabels(kind)} />;
}
