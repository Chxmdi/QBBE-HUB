import type { createSupabasePageClient } from "@/lib/supabase/page";
import type { QueryRow } from "@/lib/objects/contracts";
import { parseCoordinates } from "./map";

/**
 * Stand-in map source: events whose free-text location holds coordinates,
 * returned as query rows with a `location` property so the lens reads them
 * exactly as it will read S4's query results. Read through the viewer's own
 * client, so the event table's RLS decides what appears. Nothing is sent to a
 * geocoding service; an address with no coordinates is counted, not placed.
 */

type Client = Pick<Awaited<ReturnType<typeof createSupabasePageClient>>, "from">;

export const LOCATION_PROPERTY = "location";
export const MAP_EVENT_LIMIT = 500;

export interface MapLoad {
  rows: QueryRow[];
  /** Events with some location text that is not coordinates. */
  unlocatedCount: number;
}

export async function loadEventPlaces(client: Client): Promise<MapLoad> {
  const { data, error } = await client
    .from("event")
    .select("id, name, location, starts_at")
    .not("location", "is", null)
    .order("starts_at", { ascending: false })
    .limit(MAP_EVENT_LIMIT);
  if (error) throw new Error(error.message);
  let unlocatedCount = 0;
  const rows: QueryRow[] = [];
  for (const event of data ?? []) {
    const location = parseCoordinates(event.location);
    if (!location) {
      if (event.location?.trim()) unlocatedCount++;
      continue;
    }
    rows.push({
      ref: { id: event.id, type: "event" },
      title: event.name,
      values: {
        [LOCATION_PROPERTY]: { kind: "location", value: location },
        start: { kind: "date", value: event.starts_at },
      },
    });
  }
  return { rows, unlocatedCount };
}
