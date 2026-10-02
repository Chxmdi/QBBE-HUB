import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createPagesT } from "@/features/pages/i18n";
import { loadActivityPage, type ActivityPage } from "@/features/pages/activity/activity.queries";
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
 * Wave 2 C2: the first page of an object's activity, read on the server as
 * the viewer, then handed to the client panel. A read that fails shows the
 * error with "Try again" rather than breaking the page around it. The caller
 * decides whether the unit's switches are on.
 */
export async function ActivityFeed({ objectId, kind }: { objectId: string; kind: "page" | "record" }) {
  const session = await requireSession();
  const [labels, locale] = await Promise.all([activityLabels(kind), getLocale()]);
  let initial: ActivityPage;
  try {
    initial = await loadActivityPage(objectId, locale, session.timeZone);
  } catch {
    initial = { ok: false };
  }
  return <ActivityPanel key={objectId} objectId={objectId} initial={initial} labels={labels} />;
}
