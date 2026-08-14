/**
 * Production transactional email is not a boolean of "key present".
 * A live provider client must be wired before the Hub claims Connected.
 */
export function transactionalEmailIsLive(): boolean {
  return false;
}

/** Local Mailpit path: used only when no production key is set. */
export function localMailpitEnabled(): boolean {
  return !process.env.EMAIL_PROVIDER_API_KEY;
}
