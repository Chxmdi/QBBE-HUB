import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";

/**
 * Insight screens stay invisible until the lenses switch is on. They are
 * lenses and lens-built dashboards, so they share S4's `wos_lenses` switch
 * rather than adding a switch outside the agreed list. Off means the route
 * does not exist, not that it says "forbidden".
 */
export async function requireInsightEnabled(): Promise<void> {
  if (!(await isEnabled("wos_lenses"))) notFound();
}
