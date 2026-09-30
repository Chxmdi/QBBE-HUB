import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toSpace, type Space, type SpaceRow } from "./spaces";

/** The spaces the signed-in person can see, with what they can do in each. */
export async function listMySpaces(): Promise<Space[]> {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("my_spaces");
  if (error) throw new Error(`Could not read spaces: ${error.message}`);
  return ((data ?? []) as SpaceRow[]).map(toSpace).filter((space): space is Space => space !== null);
}
