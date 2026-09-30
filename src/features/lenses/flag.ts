import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";

/** Lens screens exist only while the wos_lenses switch is on. */
export async function requireLensesEnabled(): Promise<void> {
  if (!(await isEnabled("wos_lenses"))) notFound();
}
