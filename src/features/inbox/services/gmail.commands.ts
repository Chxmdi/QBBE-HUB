"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { refreshGoogleAccessToken } from "@/features/inbox/services/gmail-sync";
import type { ActionResult } from "@/features/tasks/services/task.commands";

interface GmailHeader { name?: string; value?: string }
interface GmailPayload { body?: { data?: string }; parts?: GmailPayload[]; headers?: GmailHeader[] }

function header(headers: GmailHeader[] | undefined, name: string): string | null {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodeBase64Url(value: string | undefined): string {
  if (!value) return "";
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function plainText(payload: GmailPayload): string {
  const mime = header(payload.headers, "Content-Type") ?? "";
  if (payload.body?.data && (!mime || mime.toLowerCase().includes("text/plain"))) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const body = plainText(part);
    if (body) return body;
  }
  return "";
}

async function gmailAccess() {
  const session = await requireSession();
  const supabase = createSupabaseServiceClient();
  const { data: connection } = await supabase.from("integration_connection")
    .select("id").eq("organization_id", session.organizationId).eq("provider", "gmail")
    .eq("user_id", session.userId).eq("status", "connected").maybeSingle();
  if (!connection) throw new Error("Gmail is not connected. Reconnect Gmail and grant send permission.");
  const { data: secret } = await supabase.from("integration_secret")
    .select("access_token, refresh_token, token_expires_at").eq("connection_id", connection.id).maybeSingle();
  if (!secret?.access_token) throw new Error("Gmail authorization has expired. Reconnect Gmail.");
  let accessToken = secret.access_token as string;
  const expiry = secret.token_expires_at ? new Date(secret.token_expires_at as string).getTime() : 0;
  if (expiry && expiry < Date.now() + 60_000 && secret.refresh_token) {
    const refreshed = await refreshGoogleAccessToken(secret.refresh_token as string);
    if (!refreshed?.access_token) throw new Error("Gmail authorization has expired. Reconnect Gmail.");
    accessToken = refreshed.access_token;
    await supabase.from("integration_secret").update({
      access_token: accessToken,
      token_expires_at: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null,
    }).eq("connection_id", connection.id);
  }
  return { session, accessToken };
}

export interface GmailMessageDetail {
  id: string; messageId: string | null; threadId: string | null; subject: string | null; from: string | null; to: string | null; body: string;
}

/** Fetches one full Gmail message on demand. Bodies are not stored in Hub tables. */
export async function getGmailMessageDetail(externalId: string): Promise<GmailMessageDetail | null> {
  if (!z.string().min(1).max(200).safeParse(externalId).success) return null;
  try {
    const { accessToken } = await gmailAccess();
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(externalId)}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (!response.ok) return null;
    const item = await response.json() as { id?: string; threadId?: string; payload?: GmailPayload };
    return {
      id: item.id ?? externalId, messageId: header(item.payload?.headers, "Message-ID"), threadId: item.threadId ?? null,
      subject: header(item.payload?.headers, "Subject"), from: header(item.payload?.headers, "From"),
      to: header(item.payload?.headers, "To"), body: plainText(item.payload ?? {}),
    };
  } catch { return null; }
}

const sendSchema = z.object({ to: z.string().trim().email(), subject: z.string().trim().min(1).max(998), body: z.string().trim().min(1).max(200_000), threadId: z.string().trim().min(1).max(200).optional(), inReplyTo: z.string().trim().max(998).optional() });

/** Sends/replies through Gmail. OAuth tokens and raw MIME remain server-only. */
export async function sendGmailMessage(input: unknown): Promise<ActionResult> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid email." };
  try {
    const { session, accessToken } = await gmailAccess();
    const data = parsed.data;
    const lines = [`To: ${data.to}`, `Subject: ${data.subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8"];
    if (data.inReplyTo) lines.push(`In-Reply-To: ${data.inReplyTo}`, `References: ${data.inReplyTo}`);
    const raw = Buffer.from(`${lines.join("\r\n")}\r\n\r\n${data.body}`, "utf8").toString("base64url");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw, ...(data.threadId ? { threadId: data.threadId } : {}) }),
    });
    if (!response.ok) throw new Error(`Gmail rejected the message (${response.status}). Reconnect Gmail and grant send permission.`);
    const supabase = createSupabaseServiceClient();
    await supabase.from("audit_event").insert({ organization_id: session.organizationId, actor_id: session.userId, event_type: "integration", action: "gmail_message_sent", object_type: "integration_connection", metadata: { reply: Boolean(data.threadId) } });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not send Gmail message." }; }
}
