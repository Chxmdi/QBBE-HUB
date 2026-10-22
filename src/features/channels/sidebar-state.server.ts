import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseSidebarState, type SidebarState } from "@/features/channels/sidebar-state";
import { logEvent } from "@/lib/server-log";

/**
 * public.sidebar_state() once per request: the workspace layout and the
 * channel list both read it, and an RPC is a POST that Next.js would not
 * merge on its own. A failure is logged and gives an empty sidebar, so the
 * page still renders and the cause is not silent.
 */
export const getSidebarState = cache(async (): Promise<SidebarState> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("sidebar_state");
  if (error) logEvent("channels.sidebar_state_failed", { error: error.message }, "error");
  return parseSidebarState(error ? null : data);
});
