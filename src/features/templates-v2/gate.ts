import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";

/**
 * Templates sit on the object layer, so they appear with the wos_objects
 * switch. The agreed switch list (workspace-os-flags.sql) has no separate
 * templates switch; see the PR.
 */
export const TEMPLATES_FLAG = "wos_objects" as const;

export async function requireTemplatesV2(): Promise<void> {
  if (!(await isEnabled(TEMPLATES_FLAG))) notFound();
}
