export interface GmailListMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    internalDate?: string;
  };
  internalDate?: string;
}

export interface GmailHubRow {
  external_id: string;
  thread_id: string | null;
  subject: string | null;
  snippet: string | null;
  from_address: string | null;
  received_at: string | null;
}

function header(message: GmailListMessage, name: string): string | null {
  const found = message.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? null;
}

/** Idempotent ingest mapper — metadata only, never logs bodies (SEC-006). */
export function mapGmailListToRows(messages: GmailListMessage[]): GmailHubRow[] {
  const seen = new Set<string>();
  const rows: GmailHubRow[] = [];
  for (const message of messages) {
    if (!message.id || seen.has(message.id)) continue;
    seen.add(message.id);
    const ms = Number(message.internalDate ?? message.payload?.internalDate ?? "");
    rows.push({
      external_id: message.id,
      thread_id: message.threadId ?? null,
      subject: header(message, "Subject"),
      snippet: message.snippet ?? null,
      from_address: header(message, "From"),
      received_at: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
    });
  }
  return rows;
}
