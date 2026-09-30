import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";

/**
 * Following sits on the object layer, so it appears with the wos_objects
 * switch; the agreed switch list has no separate following switch.
 */
export const FOLLOWING_FLAG = "wos_objects" as const;

export async function requireFollowing(): Promise<void> {
  if (!(await isEnabled(FOLLOWING_FLAG))) notFound();
}
