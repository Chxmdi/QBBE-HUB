/** Accept only application-relative navigation, including encoded input. */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return "/";
    const target = new URL(value, "https://hub.invalid");
    return target.origin === "https://hub.invalid" ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
}
