import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";

/**
 * Google objects sit on the object layer, so they appear with the wos_objects
 * switch; the agreed switch list has no separate one for them.
 */
export const GOOGLE_OBJECTS_FLAG = "wos_objects" as const;

export async function requireGoogleObjects(): Promise<void> {
  if (!(await isEnabled(GOOGLE_OBJECTS_FLAG))) notFound();
}
