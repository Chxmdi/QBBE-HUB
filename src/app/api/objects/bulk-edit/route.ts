import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { crossSiteResponse, isSameOriginRequest } from "@/lib/same-origin";
import { createRequestActionRegistry, statusForActionFailure } from "@/features/objects/actions/server";
import { BULK_EDIT_LIMIT, SET_PROPERTY_ACTION } from "@/features/objects/actions/set-property";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  objectIds: z.array(z.string().uuid()).min(1).max(BULK_EDIT_LIMIT),
  objectType: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  property: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  value: z.unknown(),
});

/**
 * Bulk edit (Workspace OS M13): set one property on many objects as one
 * change set that can be undone. Hidden unless `wos_objects` is on, and only
 * for requests from the Hub's own pages: the session cookie must not be
 * usable from somebody else's site.
 */
export async function POST(request: Request) {
  if (!(await isEnabled("wos_objects"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isSameOriginRequest(request)) return crossSiteResponse();
  const session = await getSessionContext();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { registry, context } = await createRequestActionRegistry(session.userId);
  const result = await registry.run(SET_PROPERTY_ACTION, { ...parsed.data, value: parsed.data.value ?? null }, context);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: result.message ?? null },
      { status: statusForActionFailure(result.reason, result.message) },
    );
  }
  return NextResponse.json({ changeSetId: result.changeSet.id, changed: result.changeSet.changes.length });
}
