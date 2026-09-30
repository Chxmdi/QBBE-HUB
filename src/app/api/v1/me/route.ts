import { apiJson, apiRoute } from "@/features/api-tokens/services/api-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who the token acts as, and what it may do. */
export const GET = apiRoute(null, async ({ identity }) =>
  apiJson({
    data: {
      tokenId: identity.tokenId,
      userId: identity.userId,
      organizationId: identity.organizationId,
      scopes: identity.scopes,
    },
  }));
