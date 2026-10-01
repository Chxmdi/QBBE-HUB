import { NextResponse } from "next/server";
import { requestOrigin } from "@/lib/request-origin";
import { crossSiteResponse, isSameOriginRequest } from "@/lib/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Signs the person out and sends them to the sign-in page, on the host their
 * browser is using (so the cleared cookies are the ones it holds). Only the
 * Hub's own pages may do this: a page elsewhere must not be able to end a
 * session it does not own.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return crossSiteResponse();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/sign-in", requestOrigin(request)), {
    status: 302,
  });
}
