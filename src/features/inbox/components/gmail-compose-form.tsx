"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { sendGmailMessage } from "@/features/inbox/services/gmail.commands";

export function GmailComposeForm() {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    const result = await sendGmailMessage({ to, subject, body });
    setSending(false);
    if (!result.ok) {
      toast(result.error ?? "Could not send message.", { tone: "error" });
      return;
    }
    setTo("");
    setSubject("");
    setBody("");
    toast("Message sent through Gmail.");
  }

  return (
    <form onSubmit={submit} className="card mb-5 space-y-3 p-4" aria-label="Compose Gmail message">
      <p className="text-[14px] font-semibold">Compose</p>
      <div>
        <Label htmlFor="gmail-compose-to">To</Label>
        <Input
          id="gmail-compose-to"
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          required
          autoComplete="email"
          placeholder="recipient@example.org"
        />
      </div>
      <div>
        <Label htmlFor="gmail-compose-subject">Subject</Label>
        <Input
          id="gmail-compose-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
          maxLength={998}
        />
      </div>
      <div>
        <Label htmlFor="gmail-compose-body">Message</Label>
        <Textarea
          id="gmail-compose-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
          maxLength={200000}
          rows={6}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={sending}>
          <Send className="size-4" aria-hidden />
          Send
        </Button>
      </div>
    </form>
  );
}
