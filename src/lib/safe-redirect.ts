/** Accept only application-relative navigation, including encoded input. */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000- ]/.test(decoded)) return "/";
    const target = new URL(value, "https://hub.invalid");
    if (target.origin !== "https://hub.invalid") return "/";
    // Check the parsed result too: the parser removes dot segments, so input
    // such as "/.//host" only becomes "//host" here, and a router reads a
    // leading "//" as another site.
    const path = `${target.pathname}${target.search}${target.hash}`;
    return path.startsWith("//") || path.startsWith("/\\") ? "/" : path;
  } catch {
    return "/";
  }
}

/**
 * A stored link (a notification's, for instance) used as-is only when it is
 * already a plain in-app path that safeRedirectPath leaves unchanged;
 * anything else becomes `fallback`.
 */
export function inAppLink(link: string | null | undefined, fallback: string | null = null): string | null {
  if (!link) return fallback;
  return safeRedirectPath(link) === link ? link : fallback;
}

/**
 * The shape the database accepts for a stored notification link (the
 * notification_link_in_app constraint): one leading slash, not two, and only
 * URL-safe characters.
 */
export const IN_APP_LINK_PATTERN = /^\/([A-Za-z0-9_?=&%.#~:@!*()+,;-][A-Za-z0-9/_?=&%.#~:@!*()+,;-]*)?$/;
