"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { addRecordComment, resolveRecordComment } from "../services/comment.commands";

export function RecordComments({
  parentType,
  parentId,
  comments,
}: {
  parentType: string;
  parentId: string;
  comments: {
    id: string;
    body: string;
    author_id: string;
    created_at: string;
    resolved_at: string | null;
    deleted_at: string | null;
  }[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await addRecordComment({ parentType, parentId, body });
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save the comment.");
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <section aria-labelledby={`comments-${parentId}`} className="mt-8">
      <h2 id={`comments-${parentId}`} className="section-heading mb-3">
        Comments
      </h2>
      {comments.length === 0 ? (
        <p className="meta mb-4">No comments yet.</p>
      ) : (
        <ul className="card mb-4 divide-y divide-line">
          {comments.map((comment) => (
            <li key={comment.id} id={`comment-${comment.id}`} className="px-4 py-3">
              <p className="text-[13.5px]">
                {comment.deleted_at ? "This comment was deleted." : comment.body}
              </p>
              <p className="meta mt-1">
                {new Date(comment.created_at).toLocaleString()}
                {comment.resolved_at ? " · resolved" : ""}
              </p>
              {!comment.resolved_at && !comment.deleted_at ? (
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={async () => {
                    await resolveRecordComment(comment.id);
                    router.refresh();
                  }}
                >
                  Resolve
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="space-y-3">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a comment"
          maxLength={5000}
          required
        />
        {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
        <Button type="submit" loading={pending} disabled={pending}>
          Post comment
        </Button>
      </form>
    </section>
  );
}
