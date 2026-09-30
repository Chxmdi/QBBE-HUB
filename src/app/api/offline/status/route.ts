import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/feature-flags";

/**
 * Whether offline mode is on (V3-1). The service worker asks this whenever it
 * is online; when the wos_offline switch is off it clears its caches and
 * unregisters, so turning the switch off really turns offline mode off.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = await isEnabled("wos_offline");
  return NextResponse.json({ enabled }, { headers: { "Cache-Control": "no-store" } });
}
