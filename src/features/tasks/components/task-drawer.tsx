"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Link2, Send } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ListSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { TASK_STATUS_META } from "@/components/shared/status-badges";
import { addTaskComment, updateTask } from "@/features/tasks/services/task.commands";
import { StatusSelect } from "@/features/tasks/components/status-select";
import { TaskExtras } from "@/features/tasks/components/task-extras";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/utils";
import type { Option } from "@/features/tasks/components/task-create-dialog";
import type { Task, TaskComment } from "@/types/entities";

const DETAIL_SELECT =
  "id, program_id, project_id, milestone_id, title, description, status, priority, " +
  "assignee_id, reviewer_id, start_at, due_at, blocked_reason, sort_key, completed_at, " +
  "created_at, archived_at, " +
  "assignee:assignee_id(id, full_name, email, avatar_url, title, timezone), " +
  "project:project_id(id, name)";

/**
 * Task drawer (WORK-008): opens from `?task=<id>` on any list so a shared
 * URL lands on the same record, and closing restores the list context
 * without a full navigation.
 */
export function TaskDrawer({ people, isStaff = false }: { people: Option[]; isStaff?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const taskId = searchParams.get("task");

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [checklist, setChecklist] = useState<{ id: string; title: string; completed_at: string | null }[]>([]);
  const [blockers, setBlockers] = useState<{ blocking_task_id: string; title: string }[]>([]);
  const [peopleTasks, setPeopleTasks] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setNotFound(false);
    const supabase = createSupabaseBrowserClient();
    const [{ data: taskRow }, { data: commentRows }, { data: checkRows }, { data: depRows }, { data: taskOptions }] = await Promise.all([
      supabase.from("task").select(DETAIL_SELECT + ", recurrence_rule").eq("id", id).maybeSingle(),
      supabase
        .from("task_comment")
        .select(
          "id, task_id, author_id, body, created_at, author:author_id(id, full_name, email, avatar_url, title, timezone)",
        )
        .eq("task_id", id)
        .is("deleted_at", null)
        .order("created_at"),
      supabase
        .from("checklist_item")
        .select("id, title, completed_at")
        .eq("task_id", id)
        .order("sort_key"),
      supabase
        .from("task_dependency")
        .select("blocking_task_id, blocking:blocking_task_id(title)")
        .eq("blocked_task_id", id),
      supabase.from("task").select("id, title").is("archived_at", null).limit(50),
    ]);
    setLoading(false);
    if (!taskRow) {
      // RLS filtered it out, or it does not exist — same message either way.
      setNotFound(true);
      setTask(null);
      return;
    }
    setTask(taskRow as unknown as Task);
    setComments((commentRows ?? []) as unknown as TaskComment[]);
    setChecklist((checkRows ?? []) as { id: string; title: string; completed_at: string | null }[]);
    setBlockers(
      ((depRows ?? []) as unknown as { blocking_task_id: string; blocking: { title: string } | null }[]).map((d) => ({
        blocking_task_id: d.blocking_task_id,
        title: d.blocking?.title ?? "Task",
      })),
    );
    setPeopleTasks((taskOptions ?? []) as { id: string; title: string }[]);
  }, []);

  useEffect(() => {
    if (!taskId) return;
    const timer = window.setTimeout(() => void load(taskId), 0);
    return () => window.clearTimeout(timer);
  }, [taskId, load]);

  function close() {
    // Drop only the task param; other filters in the URL survive.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    const query = params.toString();
    router.replace(query ? `?${query}` : window.location.pathname, {
      scroll: false,
    });
  }

  async function handleFieldSave(patch: Record<string, unknown>) {
    if (!taskId) return;
    setSaving(true);
    const result = await updateTask({ taskId, ...patch });
    setSaving(false);
    if (!result.ok) {
      toast(result.error ?? "Could not save the change.", { tone: "error" });
      return;
    }
    toast("Task updated.");
    await load(taskId);
    router.refresh();
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!taskId || !comment.trim()) return;
    setPosting(true);
    const result = await addTaskComment(taskId, comment);
    setPosting(false);
    if (!result.ok) {
      toast(result.error ?? "Comment not posted.", { tone: "error" });
      return;
    }
    setComment("");
    await load(taskId);
  }

  function copyPermalink() {
    const url = `${window.location.origin}${window.location.pathname}?task=${taskId}`;
    void navigator.clipboard.writeText(url);
    toast("Link copied. It re-checks access when opened.");
  }

  return (
    <Drawer
      open={Boolean(taskId)}
      onClose={close}
      title={task?.title ?? (notFound ? "Not available" : "Task")}
      description={task?.project?.name ?? undefined}
      width="lg"
      actions={
        task ? (
          <button
            type="button"
            onClick={copyPermalink}
            aria-label="Copy link to this task"
            title="Copy link"
            className="rounded-(--radius-sm) p-1.5 text-muted transition-colors hover:bg-surface-soft hover:text-ink"
          >
            <Link2 className="size-4" aria-hidden />
          </button>
        ) : null
      }
    >
      {loading ? (
        <ListSkeleton rows={4} />
      ) : notFound ? (
        <div className="py-10 text-center">
          <p className="text-[14px] font-medium">
            This task isn&apos;t available to you
          </p>
          <p className="mt-1 text-[13px] text-muted">
            It may have been archived, or your access doesn&apos;t include it.
            Every link re-checks authorization.
          </p>
        </div>
      ) : task ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusSelect taskId={task.id} status={task.status} />
            {task.project ? (
              <Link
                href={`/projects/${task.project.id}`}
                className="text-[12.5px] font-medium text-brand-fg hover:underline"
              >
                {task.project.name} →
              </Link>
            ) : null}
          </div>

          {task.blocked_reason ? (
            <p className="rounded-(--radius-sm) bg-danger/10 px-3 py-2 text-[13px] text-danger-fg">
              <span className="font-medium">Blocked:</span> {task.blocked_reason}
            </p>
          ) : null}

          <div>
            <Label htmlFor="drawer-description">Description</Label>
            <Textarea
              id="drawer-description"
              defaultValue={task.description ?? ""}
              rows={4}
              placeholder="Add context and completion criteria…"
              onBlur={(e) => {
                if (e.target.value !== (task.description ?? "")) {
                  void handleFieldSave({ description: e.target.value || null });
                }
              }}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="drawer-assignee">Assignee</Label>
              <Select
                id="drawer-assignee"
                defaultValue={task.assignee_id ?? ""}
                onChange={(e) =>
                  void handleFieldSave({ assigneeId: e.target.value || null })
                }
              >
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="drawer-priority">Priority</Label>
              <Select
                id="drawer-priority"
                defaultValue={task.priority}
                onChange={(e) => void handleFieldSave({ priority: e.target.value })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="drawer-due">Due date</Label>
              <Input
                id="drawer-due"
                type="date"
                defaultValue={task.due_at ?? ""}
                onChange={(e) => void handleFieldSave({ dueAt: e.target.value || null })}
              />
            </div>
            <div>
              {/* Read-only, so it is a description list rather than a label:
                  <label for> only binds to a form control. */}
              <dl>
                <dt className="mb-1.5 block text-[13px] font-medium text-ink">
                  Current status
                </dt>
                <dd className="flex h-9.5 items-center text-[13.5px] text-muted">
                  {TASK_STATUS_META[task.status].label}
                  {saving ? " · saving…" : ""}
                </dd>
              </dl>
            </div>
          </div>

          <TaskExtras
            taskId={task.id}
            isStaff={isStaff}
            recurrenceRule={(task as Task & { recurrence_rule?: string | null }).recurrence_rule ?? null}
            checklist={checklist}
            blockers={blockers}
            peopleTasks={peopleTasks}
          />

          <section aria-labelledby="drawer-comments">
            <h3 id="drawer-comments" className="section-heading mb-2">
              Comments
            </h3>
            {comments.length === 0 ? (
              <p className="text-[13px] text-muted">
                No comments yet. Discussion here stays attached to the task.
              </p>
            ) : (
              <ol className="space-y-3">
                {comments.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <Avatar
                      name={c.author?.full_name ?? "Unknown"}
                      src={c.author?.avatar_url}
                      size="sm"
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="flex items-baseline gap-2">
                        <span className="text-[13px] font-semibold">
                          {c.author?.full_name ?? "Unknown"}
                        </span>
                        <span className="meta">{relativeTime(c.created_at)}</span>
                      </p>
                      <p className="text-[13.5px] whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <form onSubmit={handleComment} className="mt-3 flex items-end gap-2">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment…"
                aria-label="Add a comment"
                rows={2}
                className="min-h-10"
              />
              <Button type="submit" loading={posting} disabled={!comment.trim()} aria-label="Post comment">
                <Send className="size-4" aria-hidden />
              </Button>
            </form>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
