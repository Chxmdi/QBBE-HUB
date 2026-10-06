import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";

/** The forms screens exist only while the wos_forms_v2 switch is on. */
export async function requireFormsV2(): Promise<void> {
  if (!(await isEnabled("wos_forms_v2"))) notFound();
}

export const FORM_STATUS_TONE = {
  draft: "neutral",
  published: "success",
  closed: "warning",
} as const;
