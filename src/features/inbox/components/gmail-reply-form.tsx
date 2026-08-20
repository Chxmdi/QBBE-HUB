"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { sendGmailMessage } from "@/features/inbox/services/gmail.commands";

export function GmailReplyForm({ to, subject, threadId, messageId }: { to: string; subject: string; threadId: string | null; messageId: string | null }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSending(true);
    const result = await sendGmailMessage({ to, subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`, body, threadId: threadId ?? undefined, inReplyTo: messageId ?? undefined });
    setSending(false);
    if (!result.ok) { toast(result.error ?? "Could not send reply.", { tone: "error" }); return; }
    setBody(""); toast("Reply sent through Gmail.");
  }
  return <form onSubmit={submit} className="mt-4 space-y-2 border-t border-line pt-4">
    <Label htmlFor="gmail-reply">Reply</Label>
    <Textarea id="gmail-reply" value={body} onChange={(event) => setBody(event.target.value)} required maxLength={200000} rows={5} placeholder="Write your reply…" />
    <div className="flex justify-end"><Button type="submit" loading={sending}><Send className="size-4" aria-hidden />Send reply</Button></div>
  </form>;
}
