import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { crossSiteResponse, isSameOriginRequest } from "@/lib/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Leaving a page in one tab (wave 2, C1): `?tab=<the tab's id>`. A closing tab sends this with
 * navigator.sendBeacon, which the browser delivers even as the page unloads
 * (a server action's request is cancelled with it), so the others see the
 * person leave at once rather than when their row goes stale. Only removes
 * the caller's own row; off with either switch.
 */
export async function DELETE(request: Request, context: { params: Promise<{ pageId: string }> }) {
  return leave(request, context);
}

/** sendBeacon can only POST. */
export async function POST(request: Request, context: { params: Promise<{ pageId: string }> }) {
  return leave(request, context);
}

async function leave(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const [pages, editor] = await Promise.all([isEnabled("wos_pages"), isEnabled("wos_editor")]);
  if (!pages || !editor) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isSameOriginRequest(request)) return crossSiteResponse();
  const session = await getSessionContext();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { pageId } = await params;
  const tabId = new URL(request.url).searchParams.get("tab") ?? "";
  if (!UUID.test(pageId) || !UUID.test(tabId)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("page_presence_leave", { p_page: pageId, p_tab: tabId });
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
