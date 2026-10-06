import type { PropertyValue, QueryRow } from "@/lib/objects/contracts";

/**
 * The map lens model (V2-1): objects with a location property placed on
 * OpenStreetMap tiles. Pure Web Mercator arithmetic, so the page renders on
 * the server with no mapping library and no script, and the same numbers
 * drive the list alternative.
 */

export type Location = Extract<PropertyValue, { kind: "location" }>["value"];

export interface LocatedRow {
  row: QueryRow;
  location: Location;
}

export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 17;

export function isValidLocation(value: unknown): value is Location {
  if (!value || typeof value !== "object") return false;
  const { lat, lng } = value as { lat: unknown; lng: unknown };
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 85 && Math.abs(lng) <= 180
  );
}

/** Rows whose `property` holds a usable location, in row order. */
export function locatedRows(rows: QueryRow[], property: string): LocatedRow[] {
  return rows.flatMap((row) => {
    const value = row.values[property];
    return value?.kind === "location" && isValidLocation(value.value) ? [{ row, location: value.value }] : [];
  });
}

/**
 * Coordinates typed into a free-text location, e.g. "45.5019, -73.5674" or
 * "Centre (45.50, -73.56)". Stand-in until location is a real property kind
 * (S1): today's records keep location as text, and the Hub never sends
 * addresses to a geocoding service.
 */
export function parseCoordinates(text: string | null | undefined): Location | null {
  if (!text) return null;
  const match = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const location = { lat: Number(match[1]), lng: Number(match[2]), label: text.trim() };
  return isValidLocation(location) ? location : null;
}

/** Position in world pixels at a zoom level. */
export function project(location: Pick<Location, "lat" | "lng">, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((location.lat * Math.PI) / 180);
  return {
    x: ((location.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** The inverse of `project`. */
export function unproject(point: { x: number; y: number }, zoom: number): { lat: number; lng: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(Math.round(zoom), MIN_ZOOM), MAX_ZOOM);
}

/** Montréal: where QBBE works, used when nothing has a location yet. */
export const DEFAULT_VIEW: MapView = { lat: 45.5019, lng: -73.5674, zoom: 10 };

/** The closest view that shows every location with a margin. */
export function fitView(locations: Location[], width: number, height: number, padding = 40): MapView {
  if (locations.length === 0) return DEFAULT_VIEW;
  for (let zoom = MAX_ZOOM - 3; zoom > MIN_ZOOM; zoom--) {
    const points = locations.map((location) => project(location, zoom));
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) <= width - 2 * padding && Math.max(...ys) - Math.min(...ys) <= height - 2 * padding) {
      const centre = unproject({ x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 }, zoom);
      return { ...centre, zoom };
    }
  }
  const points = locations.map((location) => project(location, MIN_ZOOM));
  const centre = unproject({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  }, MIN_ZOOM);
  return { ...centre, zoom: MIN_ZOOM };
}

export interface Tile {
  key: string;
  url: string;
  left: number;
  top: number;
}

/** OpenStreetMap's standard tiles covering a viewport, with their offsets. */
export function tilesFor(view: MapView, width: number, height: number): Tile[] {
  const centre = project(view, view.zoom);
  const originX = centre.x - width / 2;
  const originY = centre.y - height / 2;
  const count = 2 ** view.zoom;
  const tiles: Tile[] = [];
  for (let ty = Math.floor(originY / TILE_SIZE); ty <= Math.floor((originY + height) / TILE_SIZE); ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(originX / TILE_SIZE); tx <= Math.floor((originX + width) / TILE_SIZE); tx++) {
      // The world repeats sideways; wrap the column, keep the offset.
      const column = ((tx % count) + count) % count;
      tiles.push({
        key: `${view.zoom}/${tx}/${ty}`,
        url: `https://tile.openstreetmap.org/${view.zoom}/${column}/${ty}.png`,
        left: Math.round(tx * TILE_SIZE - originX),
        top: Math.round(ty * TILE_SIZE - originY),
      });
    }
  }
  return tiles;
}

/** Where a location sits in the viewport, or null when it is outside it. */
export function pointIn(view: MapView, location: Location, width: number, height: number): { left: number; top: number } | null {
  const centre = project(view, view.zoom);
  const point = project(location, view.zoom);
  const left = Math.round(point.x - centre.x + width / 2);
  const top = Math.round(point.y - centre.y + height / 2);
  if (left < 0 || top < 0 || left > width || top > height) return null;
  return { left, top };
}

/** The view moved by a fraction of the viewport, for the pan buttons. */
export function panned(view: MapView, dx: number, dy: number, width: number, height: number): MapView {
  const centre = project(view, view.zoom);
  const next = unproject({ x: centre.x + dx * width, y: centre.y + dy * height }, view.zoom);
  const lat = Math.max(Math.min(next.lat, 85), -85);
  const lng = ((((next.lng + 180) % 360) + 360) % 360) - 180;
  return { lat: round(lat), lng: round(lng), zoom: view.zoom };
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
