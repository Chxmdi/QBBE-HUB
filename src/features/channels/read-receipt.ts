/**
 * Read receipts for an open channel or conversation, at most one per
 * interval. Each receipt is a server action (a session check plus an UPDATE),
 * and sending one per incoming message made a busy channel cost every viewer
 * two of them per message. Requests in between collapse into one trailing
 * receipt, so the last message seen is still marked read. Nothing is sent
 * while the tab is hidden: a message nobody looked at is not read.
 */
export function createReadReceipt(
  send: () => void,
  {
    intervalMs = 10_000,
    isVisible = () => typeof document === "undefined" || document.visibilityState === "visible",
  }: { intervalMs?: number; isVisible?: () => boolean } = {},
) {
  let pending = false;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function sendNow() {
    pending = false;
    lastSentAt = Date.now();
    send();
  }

  function schedule() {
    if (!pending || timer || !isVisible()) return;
    const wait = lastSentAt + intervalMs - Date.now();
    if (wait <= 0) {
      sendNow();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      schedule();
    }, wait);
  }

  function dispose() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return {
    /** Something new is on screen: mark it read now or at the next slot. */
    request() {
      pending = true;
      schedule();
    },
    /** The tab became visible again. */
    visible: schedule,
    /** The view is closing: send what is still owed, then stop. */
    flush() {
      dispose();
      if (pending && isVisible()) sendNow();
    },
    dispose,
  };
}
