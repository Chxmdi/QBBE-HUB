import Link from "next/link";
import { MapPin } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { InsightT } from "@/features/insight/i18n/translate";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, panned, pointIn, tilesFor, type LocatedRow, type MapView } from "../map";

/**
 * The map lens (V2-1). Rendered on the server: OpenStreetMap tiles as plain
 * images, numbered markers as links, and zoom and pan as links too, so it
 * works with a keyboard and without scripts. The numbered list below carries
 * the same places as text. S4's lens switcher mounts it with any rows whose
 * location property is set (see `locatedRows`).
 */

export const MAP_WIDTH = 720;
export const MAP_HEIGHT = 440;

export interface MapLensProps {
  located: LocatedRow[];
  /** Rows the query returned without a usable location. */
  unlocatedCount: number;
  view: MapView;
  t: InsightT;
  hrefFor: (view: MapView | null) => string;
  /** Where each object opens. */
  openHref: (located: LocatedRow) => string | null;
}

const control =
  "flex size-9 items-center justify-center rounded-(--radius-sm) border border-line bg-surface text-ink shadow-(--shadow-raise) hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-brand";

export function MapLens({ located, unlocatedCount, view, t, hrefFor, openHref }: MapLensProps) {
  if (located.length === 0) {
    return (
      <EmptyState
        icon={<MapPin />}
        title={t("map.emptyTitle")}
        description={unlocatedCount ? t("map.emptyUnlocated", { count: unlocatedCount }) : t("map.emptyDescription")}
      />
    );
  }
  const tiles = tilesFor(view, MAP_WIDTH, MAP_HEIGHT);
  const zoomTo = (zoom: number) => hrefFor({ ...view, zoom: clampZoom(zoom) });
  const pan = (dx: number, dy: number) => hrefFor(panned(view, dx, dy, MAP_WIDTH, MAP_HEIGHT));
  const offMap = located.filter((item) => !pointIn(view, item.location, MAP_WIDTH, MAP_HEIGHT)).length;

  return (
    <section aria-labelledby="map-lens-heading" className="space-y-3">
      <p id="map-lens-heading" className="text-body-sm text-muted">
        {t("map.summary", { count: located.length })}
        {unlocatedCount ? ` ${t("map.unlocated", { count: unlocatedCount })}` : ""}
        {offMap ? ` ${t("map.offMap", { count: offMap })}` : ""}
      </p>
      <div className="overflow-x-auto">
        <div
          className="relative overflow-hidden rounded-(--radius-md) border border-line bg-surface-soft"
          style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
          role="region"
          aria-label={t("map.mapLabel", { count: located.length })}
        >
          {tiles.map((tile) => (
            // Tiles are decoration; the list below is the text equivalent.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={tile.key}
              src={tile.url}
              alt=""
              width={256}
              height={256}
              loading="lazy"
              decoding="async"
              referrerPolicy="strict-origin-when-cross-origin"
              className="pointer-events-none absolute max-w-none select-none"
              style={{ left: tile.left, top: tile.top }}
            />
          ))}
          <ol>
            {located.map((item, index) => {
              const point = pointIn(view, item.location, MAP_WIDTH, MAP_HEIGHT);
              if (!point) return null;
              const href = openHref(item);
              const label = t("map.markerLabel", { number: index + 1, title: item.row.title });
              const marker = (
                <span className="flex size-7 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-br-none border-2 border-surface bg-brand text-meta font-semibold text-white shadow-(--shadow-pop) rotate-45">
                  <span className="-rotate-45">{index + 1}</span>
                </span>
              );
              return (
                <li key={item.row.ref.id} className="absolute" style={{ left: point.left, top: point.top }}>
                  {href ? (
                    <Link href={href} aria-label={label} title={item.row.title} className="block rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                      {marker}
                    </Link>
                  ) : (
                    <span role="img" aria-label={label} title={item.row.title}>{marker}</span>
                  )}
                </li>
              );
            })}
          </ol>
          <nav aria-label={t("map.controls")} className="absolute left-2 top-2 grid grid-cols-3 gap-1">
            <span />
            <Link href={pan(0, -0.5)} className={control} aria-label={t("map.panNorth")}>↑</Link>
            <span />
            <Link href={pan(-0.5, 0)} className={control} aria-label={t("map.panWest")}>←</Link>
            <Link href={hrefFor(null)} className={`${control} text-meta`} aria-label={t("map.fit")}>⤢</Link>
            <Link href={pan(0.5, 0)} className={control} aria-label={t("map.panEast")}>→</Link>
            <span />
            <Link href={pan(0, 0.5)} className={control} aria-label={t("map.panSouth")}>↓</Link>
            <span />
            {view.zoom < MAX_ZOOM ? (
              <Link href={zoomTo(view.zoom + 1)} className={control} aria-label={t("map.zoomIn")}>+</Link>
            ) : <span />}
            <span />
            {view.zoom > MIN_ZOOM ? (
              <Link href={zoomTo(view.zoom - 1)} className={control} aria-label={t("map.zoomOut")}>−</Link>
            ) : <span />}
          </nav>
          <p className="absolute bottom-0 right-0 rounded-tl-(--radius-sm) bg-surface/90 px-1.5 py-0.5 text-meta text-ink">
            ©{" "}
            <a href="https://www.openstreetmap.org/copyright" className="underline" rel="noreferrer" target="_blank">
              {t("map.attribution")}
            </a>
          </p>
        </div>
      </div>
      <h2 className="text-body font-semibold text-ink">{t("map.listHeading")}</h2>
      <ol className="divide-y divide-line rounded-(--radius-md) border border-line bg-surface">
        {located.map((item, index) => {
          const href = openHref(item);
          return (
            <li key={item.row.ref.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-body-sm">
              <span className="font-semibold text-muted" aria-hidden="true">{index + 1}.</span>
              {href ? (
                <Link href={href} className="font-medium text-brand-fg hover:underline">{item.row.title}</Link>
              ) : (
                <span className="font-medium text-ink">{item.row.title}</span>
              )}
              <span className="text-muted">
                {item.location.label ?? `${item.location.lat.toFixed(4)}, ${item.location.lng.toFixed(4)}`}
              </span>
              <Link
                href={hrefFor({ lat: item.location.lat, lng: item.location.lng, zoom: Math.max(view.zoom, 14) })}
                className="text-meta text-muted underline hover:text-ink"
                aria-label={t("map.showOnMap", { title: item.row.title })}
              >
                {t("map.showOnMapShort")}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
