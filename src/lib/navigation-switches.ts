import { NAV_SWITCH_KEYS, type NavSwitches, type NavSwitchKey } from "@/config/navigation";
import { WORKSPACE_OS_FLAGS_ENV } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The Workspace OS switches the menus need, read once per request on the
 * server (W0-4, epic #199) and passed down to the shell, so the sidebar, the
 * mobile tabs and the command palette never fetch a switch themselves.
 *
 * Same rules as `isEnabled` in src/lib/feature-flags.ts: the WORKSPACE_OS_FLAGS
 * override (a comma-separated list of keys, or `all`) can only turn a switch
 * on; the rest is read through the caller's own session, so a signed-out
 * request, a missing row or a read error all read as off. One query covers
 * every key rather than one round trip per switch.
 */

type SwitchReader = Pick<
  Awaited<ReturnType<typeof createSupabaseServerClient>>,
  "from"
>;

/** The keys the environment override turns on, including the S5b ones. */
export function overriddenNavSwitches(
  raw: string | undefined = process.env[WORKSPACE_OS_FLAGS_ENV],
): ReadonlySet<NavSwitchKey> {
  const names = (raw ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes("all")) return new Set(NAV_SWITCH_KEYS);
  return new Set(NAV_SWITCH_KEYS.filter((key) => names.includes(key)));
}

export async function readNavigationSwitches(client?: SwitchReader): Promise<NavSwitches> {
  const switches: NavSwitches = {};
  const overridden = overriddenNavSwitches();
  for (const key of overridden) switches[key] = true;
  const remaining = NAV_SWITCH_KEYS.filter((key) => !overridden.has(key));
  if (remaining.length === 0) return switches;

  const reader = client ?? (await createSupabaseServerClient());
  const { data, error } = await reader
    .from("feature_flag")
    .select("key, enabled")
    .in("key", remaining);
  if (error || !data) return switches;
  for (const row of data) {
    if (row.enabled === true && (NAV_SWITCH_KEYS as readonly string[]).includes(row.key)) {
      switches[row.key as NavSwitchKey] = true;
    }
  }
  return switches;
}
