import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";

/**
 * Object layer screens stay invisible until the `wos_objects` switch is on.
 * Off means the route does not exist, not that it says "forbidden".
 */
export async function requireObjectsEnabled(): Promise<void> {
  if (!(await isEnabled("wos_objects"))) notFound();
}
