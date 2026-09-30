import { apiJson, apiRoute } from "@/features/api-tokens/services/api-handler";
import { listObjects } from "@/features/api-tokens/services/objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Objects the token's person may view, newest change first. `?type=&limit=&cursor=` */
export const GET = apiRoute("objects:read", async ({ db, identity, request }) =>
  apiJson(await listObjects(db, identity, new URL(request.url).searchParams)));
