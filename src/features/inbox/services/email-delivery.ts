/**
 * Pure helpers for the notification email pipeline (P0-NOT-03).
 * Required announcements cannot be fully suppressed (NTF).
 */

export const CRITICAL_EMAIL_CATEGORIES = [
  "assignment",
  "mention",
  "announcement",
  "due_date",
] as const;

export type CriticalEmailCategory = (typeof CRITICAL_EMAIL_CATEGORIES)[number];

export interface DeliveryPreference {
  email_critical: boolean;
}

export interface Notifiable {
  id: string;
  category: string;
  urgency: string;
  title: string;
  body: string | null;
}

export function isCriticalEmailCategory(category: string): category is CriticalEmailCategory {
  return (CRITICAL_EMAIL_CATEGORIES as readonly string[]).includes(category);
}

/** Required/critical announcements ignore a fully-off preference. */
export function announcementCannotBeSuppressed(notification: Notifiable): boolean {
  return (
    notification.category === "announcement" &&
    (notification.urgency === "critical" || notification.urgency === "high")
  );
}

export function shouldQueueEmail(
  notification: Notifiable,
  preference: DeliveryPreference | null,
): boolean {
  if (!isCriticalEmailCategory(notification.category)) return false;
  if (announcementCannotBeSuppressed(notification)) return true;
  if (preference && preference.email_critical === false) return false;
  return true;
}

export function deliveryDedupeKey(notificationId: string, channel = "email"): string {
  return `${channel}:${notificationId}`;
}

/** JOB idempotency: a second pass with the same key must not create a row. */
export function alreadyDelivered(
  existingKeys: Set<string>,
  notificationId: string,
  channel = "email",
): boolean {
  return existingKeys.has(deliveryDedupeKey(notificationId, channel));
}

export const MAX_DELIVERY_ATTEMPTS = 5;

/** 1, 5, 25, 125 minute retry schedule, capped at five total attempts. */
export function nextDeliveryAttempt(attempts: number, now = new Date()): string | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  const minutes = 5 ** Math.max(0, attempts - 1);
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function deliveryCanRetry(
  delivery: { status: string; attempts: number; next_attempt_at: string | null },
  now = new Date(),
): boolean {
  return delivery.status === "failed" && delivery.attempts < MAX_DELIVERY_ATTEMPTS &&
    (!delivery.next_attempt_at || new Date(delivery.next_attempt_at).getTime() <= now.getTime());
}
