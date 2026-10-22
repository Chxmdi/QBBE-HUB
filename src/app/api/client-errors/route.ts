import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { crossSiteResponse, isSameOriginRequest } from "@/lib/same-origin";

/**
 * POST /api/client-errors: an error boundary in the browser reports a crash.
 *
 * ERROR_MONITORING_DSN is a server setting the browser never sees, so the
 * boundaries post here and the server forwards to monitoring. Open to
 * signed-out pages (the root boundary covers /sign-in), so it accepts only
 * requests a browser on this site's own pages sends (a script without the
 * browser's origin headers is refused), a small body, a short single-line
 * message and a path without its query string, and is rate limited per
 * address.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4096;

const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ");

export async function POST(request: Request) {
  // Browsers always send one of these on a POST; isSameOriginRequest lets a
  // request with neither through, which is right for cookies but not here.
  const fromBrowser = request.headers.has("sec-fetch-site") || request.headers.has("origin");
  if (!fromBrowser || !isSameOriginRequest(request)) return crossSiteResponse();
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return new NextResponse(null, { status: 413 });

  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await checkRateLimit({ action: "client-error:report", subject: address, ...RATE_LIMITS["client-error:report"] });
  if (!limit.allowed) return new NextResponse(null, { status: 429 });

  const text = await request.text();
  if (text.length > MAX_BODY) return new NextResponse(null, { status: 413 });
  let body: { message?: unknown; digest?: unknown; path?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // One line: a line break would let the text pose as a separate log entry.
  const message = typeof body.message === "string" ? oneLine(body.message).slice(0, 300) : "unknown";
  const digest = typeof body.digest === "string" && /^[\w-]{1,64}$/.test(body.digest) ? body.digest : undefined;
  const path = typeof body.path === "string" ? oneLine(body.path.split(/[?#]/)[0]).slice(0, 200) : undefined;
  reportError(message, { source: "browser", digest, path });
  return new NextResponse(null, { status: 204 });
}
