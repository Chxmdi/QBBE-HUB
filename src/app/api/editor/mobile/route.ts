import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { mobileEnabled } from "@/features/mobile/flag";

/**
 * Whether mobile editing (wave 2 unit E4) is on for this person: the editor
 * and phone switches both, and a signed-in session. The editor asks once per
 * page load; anything but `{ enabled: true }` leaves it exactly as on desktop.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionContext();
  const enabled = Boolean(session) && (await Promise.all([isEnabled("wos_editor"), mobileEnabled()])).every(Boolean);
  return NextResponse.json({ enabled }, { headers: { "Cache-Control": "no-store" } });
}
