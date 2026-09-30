import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";

/**
 * Upkeep reports sit on the object layer, so they appear with the wos_objects
 * switch; the agreed switch list has no separate upkeep switch.
 */
export const UPKEEP_FLAG = "wos_objects" as const;

export async function requireUpkeep(): Promise<void> {
  if (!(await isEnabled(UPKEEP_FLAG))) notFound();
}
