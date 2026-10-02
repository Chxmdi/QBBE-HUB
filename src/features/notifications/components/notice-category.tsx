import { getPagesT } from "@/features/pages/i18n/server";

const PAGE_NOTICE_CATEGORIES = ["comment", "watched_page"] as const;

/**
 * The inbox badge for a notification category. The page notices added in
 * wave 2 (C3) carry their own label in both languages; every other category
 * keeps the label the inbox already gives it.
 */
export async function NoticeCategory({ category, fallback }: { category: string; fallback: string }) {
  if (!(PAGE_NOTICE_CATEGORIES as readonly string[]).includes(category)) return fallback;
  const t = await getPagesT();
  return category === "comment" ? t("units.c3.inbox.comment") : t("units.c3.inbox.watched_page");
}
