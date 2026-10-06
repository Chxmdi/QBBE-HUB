import { type NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/lib/security/content-security-policy";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  // A fresh nonce per request (staging audit S1). Next.js reads the policy
  // from the request to put the nonce on its own scripts; the root layout
  // reads `x-nonce` for the theme script. The browser gets the same policy.
  const nonce = createNonce();
  const policy = contentSecurityPolicy({ nonce });
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", policy);
  const response = await updateSession(request);
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on all paths except static assets. /ocr/ holds the open-source
     * receipt-reading engine (public/ocr, copied from node_modules): no
     * session is needed to serve it, and it is ~15 MB. /pdf/ is the same
     * for the PDF reader document search uses (public/pdf, #147). The web app
     * manifest is fetched by the browser without a session to offer "Install"
     * (V1-16), so a sign-in redirect there would make the app uninstallable.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|brand|images|ocr/|pdf/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
