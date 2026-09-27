import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on all paths except static assets. /ocr/ holds the open-source
     * receipt-reading engine (public/ocr, copied from node_modules): no
     * session is needed to serve it, and it is ~15 MB. /pdf/ is the same
     * for the PDF reader document search uses (public/pdf, #147).
     */
    "/((?!_next/static|_next/image|favicon.ico|brand|images|ocr/|pdf/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
