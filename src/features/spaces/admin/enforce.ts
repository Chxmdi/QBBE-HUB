import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decideSignIn, type SignInDecision, type SignInStatus } from "./sign-in-rules";

/**
 * What the caller's role's sign-in rules (V2-9) require of this session.
 *
 * Integration wires it into two shared files: the workspace layout calls it on
 * every signed-in page and redirects on "mfa" (to /mfa) or "sign_in_again"
 * (signing out); and /mfa admits anyone whose rule requires two-step sign-in,
 * not only owners, admins and the accountant. Until then the rules are
 * stored, audited and reported, but not enforced for the new roles.
 */
export async function getSignInDecision(): Promise<SignInDecision> {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("my_sign_in_status");
  if (error) return { action: "allow" };
  return decideSignIn((data ?? null) as SignInStatus | null);
}
