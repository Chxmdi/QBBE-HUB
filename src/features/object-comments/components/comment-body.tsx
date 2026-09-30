import { Fragment } from "react";
import { splitBody } from "../mentions";
import type { MentionLabel } from "../services/object-comment.queries";
import { objectCommentsPath } from "../target";
import type { ObjectCommentsText } from "../messages";

/**
 * A comment's text with its mentions shown as names. An object mention links
 * to the object when the reader can open it and is otherwise replaced by a
 * neutral phrase, so a comment never reveals an object's title to someone who
 * cannot see it.
 */
export function CommentBody({
  body,
  mentions,
  m,
}: {
  body: string;
  mentions: Record<string, MentionLabel>;
  m: ObjectCommentsText;
}) {
  return (
    <p className="mt-0.5 text-[13.5px] whitespace-pre-wrap">
      {splitBody(body).map((segment, index) => {
        if (segment.type === "text") return <Fragment key={index}>{segment.text}</Fragment>;
        const { kind, id } = segment.mention;
        const known = mentions[`${kind}:${id}`];
        if (kind === "person") {
          return (
            <span key={index} className="rounded-(--radius-sm) bg-brand-soft px-1 font-medium text-brand-fg">
              @{known?.label ?? segment.mention.label}
            </span>
          );
        }
        if (!known?.label) {
          return (
            <span key={index} className="meta italic">
              @{m.hiddenObject}
            </span>
          );
        }
        return (
          <a
            key={index}
            href={objectCommentsPath({ id, type: known.type ?? "object" })}
            className="rounded-(--radius-sm) bg-surface-soft px-1 font-medium text-brand-fg hover:underline"
          >
            @{known.label}
          </a>
        );
      })}
    </p>
  );
}
