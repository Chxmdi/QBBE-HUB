import { apiJson, apiRoute } from "@/features/api-tokens/services/api-handler";
import { getObject } from "@/features/api-tokens/services/objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute<{ id: string }>("objects:read", async ({ db, identity }, { id }) =>
  apiJson({ data: await getObject(db, identity, id) }));
