import { apiJson, apiRoute } from "@/features/api-tokens/services/api-handler";
import { listActions } from "@/features/api-tokens/services/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute("actions:run", async () => apiJson(listActions()));
