export type GoogleIntegrationProvider = "gmail" | "google_calendar" | "google_drive";

export const GOOGLE_PROVIDER_SCOPES: Record<GoogleIntegrationProvider, readonly string[]> = {
  // Hub reads Gmail metadata/full messages on demand and sends mail. It never
  // modifies labels, read state, trash, or mailbox contents.
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  google_calendar: [
    "https://www.googleapis.com/auth/calendar.events",
  ],
  google_drive: [
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ],
};

export function googleScopeString(provider: GoogleIntegrationProvider): string {
  return GOOGLE_PROVIDER_SCOPES[provider].join(" ");
}
