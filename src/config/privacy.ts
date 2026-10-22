/**
 * The privacy notice at /privacy (Law 25, s. 8 and s. 3.2).
 *
 * The text itself is in the message catalogues (`privacy.*`), French and
 * English. Change PRIVACY_NOTICE_VERSION whenever its meaning changes:
 * finishing onboarding records an acknowledgement of the version shown
 * (public.privacy_notice_acknowledgement).
 *
 * The notice is a draft until QBBE approves it (owner action, see
 * docs/runbooks/privacy.md). While it is, the page says so and the version
 * ends in "-draft". QBBE also fills in the person in charge here; the page
 * says the role is being designated until then.
 */
export const PRIVACY_NOTICE_VERSION = "2026-10-22-draft";
export const PRIVACY_NOTICE_IS_DRAFT = PRIVACY_NOTICE_VERSION.endsWith("-draft");

export const PRIVACY_PERSON_IN_CHARGE: { title: string | null; email: string | null } = {
  title: null,
  email: null,
};
