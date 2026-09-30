import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createRequestActionRegistry, statusForActionFailure } from "@/features/objects/actions/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Undo one change set (Workspace OS M13). Refused when a value was changed
 * again since (409, with what differs), when the caller lacks the action's
 * capability on anything it touched (403), or after 30 days.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isEnabled("wos_objects"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const session = await getSessionContext();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { registry, context } = await createRequestActionRegistry(session.userId);
  const result = await registry.undo(id, context);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: result.message ?? null },
      { status: statusForActionFailure(result.reason, result.message) },
    );
  }
  return NextResponse.json({ changeSetId: result.changeSet.id, undoOf: id });
}
