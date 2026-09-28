/**
 * English text for account screens (#141). Mounted at the top level of the
 * catalogue; this file owns only these namespaces: auth, settings, notifications, onboarding, account.
 */
export const accountEn = {
  auth: {
    tagline:
      "Secure work, communication and program operations for the Quebec Board of Black Educators.",
    signIn: {
      title: "Sign in",
      submit: "Sign in",
      badCredentials:
        "That email and password combination didn't match. Check both and try again.",
      forgot: "Forgot your password?",
      newHere: "New to QBBE Hub?",
      createAccount: "Create an account",
    },
    signUp: {
      title: "Create account",
      fullName: "Full name",
      passwordHint: "At least 8 characters.",
      submit: "Create account",
      haveAccount: "Already have an account?",
      signIn: "Sign in",
      checkFailed: "Could not check whether sign-up is open. Try again.",
      inviteOnly:
        "This workspace is invite-only. Ask an administrator to send you an invitation.",
      checkEmail: "Check your email",
      confirmationSent:
        "We sent a confirmation link to {email}. Follow it to finish creating your account.",
    },
    recovery: {
      requestTitle: "Recover account",
      resetTitle: "Reset password",
      requestHeading: "Recover your account",
      resetHeading: "Choose a new password",
      requestDone:
        "If this address belongs to an account, a recovery link will arrive shortly. Open it in this browser.",
      resetDone: "Your password has been changed. Sign in with your new password.",
      passwordRules:
        "Use at least 12 characters. Your workspace may require additional password safeguards.",
      newPassword: "New password",
      confirmPassword: "Confirm password",
      sendLink: "Send recovery link",
      savePassword: "Save password",
      requestFailed: "Could not request recovery. Wait a moment and try again.",
      mismatch: "The passwords do not match.",
      updateFailed:
        "Could not change your password. Check the password requirements or request a new recovery link.",
      failed: "Could not complete recovery. Please try again.",
      sessionMissing: "Your recovery session is missing or has expired.",
      requestNewLink: "Request a new recovery link",
    },
  },
  settings: {
    title: "Account settings",
    eyebrow: "Account",
    heading: "Settings",
    description:
      "Manage how QBBE Hub notifies you. Workspace admins manage organization-wide defaults separately.",
  },
  notifications: {},
  onboarding: {},
  account: {},
};
