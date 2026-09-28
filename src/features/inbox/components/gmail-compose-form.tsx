"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { sendGmailMessage } from "@/features/inbox/services/gmail.commands";
import { useT } from "@/lib/i18n/client";

export function GmailComposeForm() {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const t = useT();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    const result = await sendGmailMessage({ to, subject, body });
    setSending(false);
    if (!result.ok) {
      toast(result.error ?? t("inbox.compose.failed"), { tone: "error" });
      return;
    }
    setTo("");
    setSubject("");
    setBody("");
    toast(t("inbox.compose.sent"));
  }

  return (
    <form onSubmit={submit} className="card mb-5 space-y-3 p-4" aria-label={t("inbox.compose.formLabel")}>
      <p className="text-[14px] font-semibold">{t("inbox.compose.heading")}</p>
      <div>
        <Label htmlFor="gmail-compose-to">{t("inbox.compose.to")}</Label>
        <Input
          id="gmail-compose-to"
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          required
          autoComplete="email"
          placeholder={t("inbox.compose.toPlaceholder")}
        />
      </div>
      <div>
        <Label htmlFor="gmail-compose-subject">{t("inbox.compose.subject")}</Label>
        <Input
          id="gmail-compose-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
          maxLength={998}
        />
      </div>
      <div>
        <Label htmlFor="gmail-compose-body">{t("inbox.compose.message")}</Label>
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
          {t("inbox.compose.send")}
        </Button>
      </div>
    </form>
  );
}
