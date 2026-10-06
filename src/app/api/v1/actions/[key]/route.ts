import { apiJson, apiRoute } from "@/features/api-tokens/services/api-handler";
import { runAction } from "@/features/api-tokens/services/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs one action as the token's person: `{ "input": { ... } }`. */
export const POST = apiRoute<{ key: string }>("actions:run", async ({ db, identity, request }, { key }) =>
  apiJson(await runAction(db, identity, key, request)));
