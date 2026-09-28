"use client";

import { useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { TASK_ROLES, taskRoleLabel, type TaskRole } from "@/features/tasks/schemas";
import { useT } from "@/lib/i18n/client";
import { removeTaskRole, setTaskRole } from "@/features/tasks/services/task.commands";
import type { Option } from "@/features/tasks/components/task-create-dialog";

export interface TaskRoleHolder {
  userId: string;
  role: TaskRole;
  fullName: string;
  avatarUrl: string | null;
}

/**
 * Everyone accountable for a task besides its owner (P0-TSK-02).
 *
 * These are not decoration: the database reads `task_assignment` when deciding
 * what somebody may do, so adding a reviewer here is what makes the task
 * reachable and reviewable by them.
 */
export function TaskRoles({
  taskId,
  people,
  holders,
  onChanged,
}: {
  taskId: string;
  people: Option[];
  holders: TaskRoleHolder[];
  onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<TaskRole>("contributor");
  const [pending, startTransition] = useTransition();

  function add() {
    if (!userId) return;
    startTransition(async () => {
      const result = await setTaskRole({ taskId, userId, role });
      if (!result.ok) {
        toast(result.error ?? t("tasks.roles.assignFailed"), { tone: "error" });
        return;
      }
      setUserId("");
      setAdding(false);
      await onChanged();
    });
  }

  function remove(holder: TaskRoleHolder) {
    startTransition(async () => {
      const result = await removeTaskRole({
        taskId,
        userId: holder.userId,
        role: holder.role,
      });
      if (!result.ok) {
        toast(result.error ?? t("tasks.roles.removeFailed"), { tone: "error" });
        return;
      }
      await onChanged();
    });
  }

  return (
    <section aria-labelledby="drawer-roles">
      <h3 id="drawer-roles" className="section-heading mb-2">
        {t("tasks.roles.heading")}
      </h3>

      {holders.length === 0 ? (
        <p className="text-[13px] text-muted">
          {t("tasks.roles.empty")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {holders.map((holder) => (
            <li
              key={`${holder.userId}:${holder.role}`}
              className="flex items-center gap-2"
            >
              <Avatar name={holder.fullName} src={holder.avatarUrl} size="sm" />
              <span className="text-[13.5px]">{holder.fullName}</span>
              <Badge tone="neutral">{taskRoleLabel(holder.role, t)}</Badge>
              <button
                type="button"
                onClick={() => remove(holder)}
                disabled={pending}
                aria-label={t("tasks.roles.removeAs", {
                  name: holder.fullName,
                  role: taskRoleLabel(holder.role, t).toLowerCase(),
                })}
                className="ml-auto rounded-(--radius-sm) p-1 text-muted transition-colors hover:bg-surface-soft hover:text-danger-fg"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-44 flex-1">
            <Label htmlFor="role-person">{t("tasks.roles.person")}</Label>
            <Select
              id="role-person"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">{t("tasks.roles.choose")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="role-kind">{t("tasks.roles.role")}</Label>
            <Select
              id="role-kind"
              value={role}
              onChange={(e) => setRole(e.target.value as TaskRole)}
            >
              {TASK_ROLES.map((r) => (
                <option key={r} value={r}>
                  {taskRoleLabel(r, t)}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" onClick={add} loading={pending} disabled={!userId}>
            {t("tasks.add")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={() => setAdding(true)}
        >
          <UserPlus className="size-3.5" aria-hidden />
          {t("tasks.roles.addRole")}
        </Button>
      )}
    </section>
  );
}
