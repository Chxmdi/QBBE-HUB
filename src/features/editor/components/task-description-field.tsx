"use client";

import * as React from "react";
import { useEditorT } from "@/features/editor/i18n/client";
import { loadTaskDescription, type TaskDescriptionBody } from "@/features/editor/services/task-description.commands";
import { ObjectEditor } from "./object-editor";

/**
 * The description field of the task drawer (M4d). With the `wos_editor`
 * switch on it is the block editor; otherwise, or if the document cannot be
 * read, it is the plain field passed as children, exactly as before.
 */
export function TaskDescriptionField({
  taskId,
  label,
  children,
}: {
  taskId: string;
  label: string;
  children: React.ReactNode;
}) {
  const t = useEditorT();
  const [body, setBody] = React.useState<TaskDescriptionBody | null>(null);

  React.useEffect(() => {
    let active = true;
    loadTaskDescription(taskId)
      .then((result) => {
        if (active) setBody(result);
      })
      .catch(() => {
        if (active) setBody({ enabled: false });
      });
    return () => {
      active = false;
    };
  }, [taskId]);

  if (body === null) {
    return (
      <p role="status" className="py-2 text-body-sm text-muted">
        {t("loading")}
      </p>
    );
  }
  if (!body.enabled) return <>{children}</>;
  return (
    <div className="rounded-(--radius-sm) border border-line px-1 py-2">
      <ObjectEditor
        key={taskId}
        objectId={taskId}
        objectType="task"
        initialContent={body.content}
        initialState={body.state}
        initialVersion={body.version}
        editable={body.editable}
        label={label}
      />
    </div>
  );
}
