"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { WorkflowsMessages } from "../i18n";
import { decideWorkflowReview, revealWebhookSecret } from "../services/workflow.commands";

const sectionClass = "rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5";

/** The reviewer's approve or reject, with an optional comment (V1-12). */
export function ReviewDecision({ id, m }: { id: string; m: WorkflowsMessages }) {
  const router = useRouter();
  const [comment, setComment] = React.useState("");
  const [pending, start] = React.useTransition();
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const decide = (decision: "approved" | "rejected") => {
    setMessage(null);
    start(async () => {
      const result = await decideWorkflowReview({ id, decision, comment });
      setMessage(result.ok ? { tone: "ok", text: m.review.done } : { tone: "error", text: result.error });
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="review-comment">{m.review.comment}</Label>
        <Textarea id="review-comment" maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" loading={pending} onClick={() => decide("approved")}>{m.review.approve}</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => decide("rejected")}>{m.review.reject}</Button>
        <p role={message?.tone === "error" ? "alert" : "status"}
          className={message?.tone === "error" ? "text-sm text-danger-fg" : "text-sm text-success-fg"}>
          {message?.text ?? ""}
        </p>
      </div>
    </div>
  );
}

/** Shows an admin the key their webhooks are signed with, on request. */
export function SigningKeyPanel({ id, m }: { id: string; m: WorkflowsMessages }) {
  const [secret, setSecret] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <section className={sectionClass} aria-labelledby="workflow-signing">
      <h2 id="workflow-signing" className="section-heading mb-1">{m.signing.heading}</h2>
      <p className="mb-3 text-sm text-muted">{m.signing.description}</p>
      {secret ? (
        <div>
          <Label htmlFor="signing-key">{m.signing.label}</Label>
          <Input id="signing-key" readOnly value={secret} className="font-mono text-[13px]" />
        </div>
      ) : (
        <Button type="button" variant="secondary" loading={pending} onClick={() => start(async () => {
          const result = await revealWebhookSecret({ id });
          if (result.ok) setSecret(result.secret);
          else setError(result.error);
        })}>
          {m.signing.show}
        </Button>
      )}
      {error ? <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p> : null}
    </section>
  );
}
