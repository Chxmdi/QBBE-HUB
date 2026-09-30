import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requireInsightEnabled } from "@/features/insight/gate";
import { getInsightT } from "@/features/insight/i18n/translate";
import { MAP_HEIGHT, MAP_WIDTH, MapLens } from "@/features/lenses-map/components/map-lens";
import { clampZoom, fitView, locatedRows, type MapView } from "@/features/lenses-map/map";
import { LOCATION_PROPERTY, loadEventPlaces } from "@/features/lenses-map/map.source";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getInsightT())("map.title") };
}
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A view from the address, or null when it is missing or out of range. */
function viewFrom(params: Params): MapView | null {
  const lat = Number(first(params.lat));
  const lng = Number(first(params.lng));
  const zoom = Number(first(params.z));
  if (![lat, lng, zoom].every(Number.isFinite) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  return { lat, lng, zoom: clampZoom(zoom) };
}

export default async function MapPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireInsightEnabled();
  await requireSession();
  const [params, t, client] = await Promise.all([searchParams, getInsightT(), createSupabasePageClient()]);
  const { rows, unlocatedCount } = await loadEventPlaces(client);
  const located = locatedRows(rows, LOCATION_PROPERTY);
  const view = viewFrom(params) ?? fitView(located.map((item) => item.location), MAP_WIDTH, MAP_HEIGHT);

  const hrefFor = (next: MapView | null) =>
    next ? `/insight/map?lat=${next.lat.toFixed(5)}&lng=${next.lng.toFixed(5)}&z=${next.zoom}` : "/insight/map";

  return (
    <div>
      <PageHeader eyebrow={t("common.eyebrow")} title={t("map.title")} description={t("map.description")} />
      <MapLens
        located={located}
        unlocatedCount={unlocatedCount}
        view={view}
        t={t}
        hrefFor={hrefFor}
        openHref={(item) => `/events/${item.row.ref.id}`}
      />
    </div>
  );
}
