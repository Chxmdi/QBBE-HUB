import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on all paths except static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|brand|images|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
