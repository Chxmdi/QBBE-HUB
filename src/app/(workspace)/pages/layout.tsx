import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";

/**
 * Workspace OS pages (M4a) stay hidden until the `wos_pages` switch is on.
 * Not linked from the main navigation; integration adds the menu entry.
 */
export default async function PagesLayout({ children }: { children: React.ReactNode }) {
  if (!(await isEnabled("wos_pages"))) notFound();
  return children;
}
