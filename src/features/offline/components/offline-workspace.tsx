"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { fill, type OfflineText } from "@/features/offline/messages";
import {
  IdbOpStore,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type FieldValue,
  type OfflineField,
  type OfflineOperation,
  type OpStore,
  type SyncReview,
} from "@/features/offline/op-log";
import { syncOfflineOperations } from "@/features/offline/services/offline.commands";

export interface OfflineTask {
  id: string;
  title: string;
  status: string;
  priority: string;
}

const SW_URL = "/wos-offline-sw.js";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Registers the offline service worker for this person (only mounted while wos_offline is on). */
function useServiceWorker(userId: string) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(SW_URL, { scope: "/" })
      .then(async (registration) => {
        await navigator.serviceWorker.ready;
        (registration.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "user", userId });
      })
      .catch(() => {
        // Offline reading is a convenience; queued changes work without it.
      });
  }, [userId]);
}

export function OfflineWorkspace({ userId, tasks, text }: { userId: string; tasks: OfflineTask[]; text: OfflineText }) {
  useServiceWorker(userId);
  const id = useId();
  const store = useRef<OpStore | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [ops, setOps] = useState<OfflineOperation[]>([]);
  const [reviews, setReviews] = useState<SyncReview[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "syncing" | "synced" | "failed">("idle");
  const [newTitle, setNewTitle] = useState("");
  const syncing = useRef(false);

  const refresh = useCallback(async () => {
    if (!store.current) return;
    setOps(await store.current.all());
    setReviews(await store.current.reviews());
  }, []);

  const sync = useCallback(async () => {
    const s = store.current;
    if (!s || syncing.current || !navigator.onLine) return;
    const queued = await s.all();
    if (queued.length === 0) return;
    syncing.current = true;
    setState("syncing");
    try {
      const result = await syncOfflineOperations(queued);
      if (!result.ok) throw new Error(result.error);
      const newReviews = result.outcomes.flatMap((o) => ("review" in o ? [o.review] : []));
      await s.addReviews(newReviews);
      const failedTitles = result.outcomes
        .filter((o) => o.result === "failed")
        .map((o) => queued.find((q) => q.id === o.opId))
        .map((q) => (q?.kind === "set_field" ? q.taskTitle : q?.title ?? ""));
      setFailures((f) => [...f, ...failedTitles]);
      await s.remove(result.outcomes.map((o) => o.opId));
      setState("synced");
    } catch {
      // Still offline or the server was unreachable: keep everything.
      setState("failed");
    } finally {
      syncing.current = false;
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    store.current = new IdbOpStore(userId);
    void refresh().then(sync);
    const up = () => void sync();
    window.addEventListener("online", up);
    return () => window.removeEventListener("online", up);
  }, [userId, refresh, sync]);

  // What the person sees: the server's values with their queued edits on top.
  const shown = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, { ...t } as OfflineTask & Record<string, string>]));
    const created: OfflineTask[] = [];
    for (const op of ops) {
      if (op.kind === "create_task") created.push({ id: op.taskId, title: op.title, status: "not_started", priority: "medium" });
      else {
        const task = byId.get(op.taskId);
        if (task && op.value !== null) task[op.field] = op.value;
      }
    }
    return { existing: [...byId.values()], created };
  }, [tasks, ops]);

  async function queueField(task: OfflineTask, field: OfflineField, value: FieldValue) {
    const original = tasks.find((t) => t.id === task.id) as (OfflineTask & Record<string, string>) | undefined;
    await store.current?.add({
      id: crypto.randomUUID(),
      kind: "set_field",
      createdAt: new Date().toISOString(),
      taskId: task.id,
      taskTitle: task.title,
      field,
      value,
      base: original ? (original[field] ?? null) : null,
    });
    await refresh();
    void sync();
  }

  async function queueCreate(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    await store.current?.add({ id: crypto.randomUUID(), kind: "create_task", createdAt: new Date().toISOString(), taskId: crypto.randomUUID(), title, projectId: null });
    setNewTitle("");
    await refresh();
    void sync();
  }

  const valueText = (field: OfflineField, value: FieldValue) => {
    if (value === null) return text.empty;
    if (field === "status") return text.statuses[value as keyof OfflineText["statuses"]] ?? value;
    if (field === "priority") return text.priorities[value as keyof OfflineText["priorities"]] ?? value;
    return value;
  };

  return (
    <div className="space-y-6">
      <section aria-label={online ? text.online : text.offline} className="card space-y-2 p-4">
        <p role="status" className="font-medium">
          {online ? text.online : text.offline}{" "}
          <span className="meta">{ops.length ? fill(text.pending, { count: ops.length }) : text.nothingPending}</span>
        </p>
        {state === "synced" && ops.length === 0 ? <p className="text-sm text-success-fg">{text.synced}</p> : null}
        {state === "failed" ? <p className="text-sm text-warning-fg">{text.syncFailed}</p> : null}
        <Button size="sm" variant="secondary" onClick={() => void sync()} disabled={!online || ops.length === 0} loading={state === "syncing"}>
          {state === "syncing" ? text.syncing : text.syncNow}
        </Button>
        <p className="meta">{text.readingHelp}</p>
      </section>

      {reviews.length || failures.length ? (
        <section aria-labelledby={`${id}-review`} className="card space-y-3 p-4">
          <h2 id={`${id}-review`} className="text-[15px] font-semibold">
            {text.reviewHeading}
          </h2>
          <p className="meta">{text.reviewHelp}</p>
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li key={r.opId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-b-0">
                <span className="text-sm">
                  {fill(r.winner === "server" ? text.keptTheirs : text.keptYours, {
                    field: text.fields[r.field],
                    title: r.taskTitle,
                    kept: valueText(r.field, r.kept),
                    overwritten: valueText(r.field, r.overwritten),
                  })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await store.current?.dismissReview(r.opId);
                    await refresh();
                  }}
                >
                  {text.dismiss}
                </Button>
              </li>
            ))}
            {failures.map((title, index) => (
              <li key={`f${index}`} role="alert" className="text-sm text-danger-fg">
                {fill(text.failed, { title })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby={`${id}-tasks`} className="space-y-3">
        <h2 id={`${id}-tasks`} className="text-[15px] font-semibold">
          {text.tasksHeading}
        </h2>
        <form onSubmit={queueCreate} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor={`${id}-new`}>{text.newTaskLabel}</Label>
            <Input id={`${id}-new`} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={300} />
          </div>
          <Button type="submit">{text.add}</Button>
        </form>
        {shown.existing.length + shown.created.length === 0 ? (
          <p className="meta">{text.noTasks}</p>
        ) : (
          <ul className="space-y-2">
            {shown.created.map((task) => (
              <li key={task.id} className="card p-3">
                <span className="font-medium">{task.title}</span> <span className="meta">· {text.queuedNew}</span>
              </li>
            ))}
            {shown.existing.map((task) => (
              <li key={task.id} className="card grid gap-3 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-end">
                <span className="font-medium">{task.title}</span>
                <div>
                  <Label htmlFor={`${id}-${task.id}-status`}>{fill(text.statusFor, { title: task.title })}</Label>
                  <Select id={`${id}-${task.id}-status`} value={task.status} onChange={(e) => void queueField(task, "status", e.target.value)}>
                    {TASK_STATUSES.filter((s) => s !== "blocked" || task.status === "blocked").map((s) => (
                      <option key={s} value={s}>
                        {text.statuses[s]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`${id}-${task.id}-priority`}>{fill(text.priorityFor, { title: task.title })}</Label>
                  <Select id={`${id}-${task.id}-priority`} value={task.priority} onChange={(e) => void queueField(task, "priority", e.target.value)}>
                    {TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {text.priorities[p]}
                      </option>
                    ))}
                  </Select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
