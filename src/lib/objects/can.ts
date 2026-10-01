import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { workspaceCapabilities, type Can } from "./contracts";

/**
 * The access check (`Can` in ./contracts.ts), answered by the database.
 *
 * SQL `public.can` wraps `app.can` (M10c, 20261102010300): the cached grants,
 * organization roles, membership and sign-in level, for every object type.
 * One source of truth: the capability mapping lives in the migrations, not
 * here. The answer is for the signed-in person behind `client`; anything the
 * database refuses or cannot answer is a "no".
 */
export function createCan(client: Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "rpc">): Can {
  return async (objectId, capability) => {
    if (!(workspaceCapabilities as readonly string[]).includes(capability)) return false;
    const { data, error } = await client.rpc("can", {
      object_id: objectId,
      capability,
    });
    return !error && data === true;
  };
}
