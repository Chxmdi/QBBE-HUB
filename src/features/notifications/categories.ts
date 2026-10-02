/**
 * Notification categories a person chooses about (wave 2, C3): mentions,
 * assigned work, comments, approvals and watched pages. Each can be kept out
 * of the Hub entirely (notification_preference.hub_muted_categories, enforced
 * on every insert by app.notification_hub_filter) and each has its own email
 * choice (category_modes, read by decideDelivery).
 */

export const HUB_CATEGORIES = ["mention", "assignment", "comment", "approval", "watched_page"] as const;
export type HubCategory = (typeof HUB_CATEGORIES)[number];

/** Email choices added with C3; the others were already on the form. */
export const PAGE_EMAIL_CATEGORIES = ["comment", "approval", "watched_page"] as const;
export type PageEmailCategory = (typeof PAGE_EMAIL_CATEGORIES)[number];

export function isHubCategory(value: string): value is HubCategory {
  return (HUB_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The preference a notification category answers to, or null when it cannot
 * be muted. Mirrors app.notification_hub_key: replies follow mentions, and
 * security notices, announcements and due dates are never muted here.
 */
export function hubCategoryOf(category: string): HubCategory | null {
  if (category === "reply") return "mention";
  return isHubCategory(category) ? category : null;
}

/** Whether a notification of this category is written for this person. */
export function hubAllows(category: string, muted: readonly string[]): boolean {
  const key = hubCategoryOf(category);
  return key === null || !muted.includes(key);
}

/**
 * The muted list from the preferences form: every category whose
 * `hub_<category>` box is not ticked.
 */
export function hubMutedFromForm(form: Pick<FormData, "get">): HubCategory[] {
  return HUB_CATEGORIES.filter((category) => form.get(`hub_${category}`) !== "on");
}

/** Cleans a stored list: known categories only, each once. */
export function normalizeHubMuted(value: unknown): HubCategory[] {
  if (!Array.isArray(value)) return [];
  return HUB_CATEGORIES.filter((category) => value.includes(category));
}
