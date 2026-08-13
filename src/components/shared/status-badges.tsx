import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleSlash,
  Eye,
  Hourglass,
  OctagonAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  ProjectHealth,
  ProjectStage,
  TaskPriority,
  TaskStatus,
} from "@/types/entities";

/**
 * Domain status presentation shared across features. Status always pairs
 * color with text/icon — never color alone (A11Y-004).
 */

export const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; tone: "neutral" | "info" | "warning" | "danger" | "success" | "brand" }
> = {
  not_started: { label: "Not started", tone: "neutral" },
  ready: { label: "Ready", tone: "info" },
  in_progress: { label: "In progress", tone: "brand" },
  waiting: { label: "Waiting", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
  in_review: { label: "In review", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const taskStatusIcons: Record<TaskStatus, React.ReactNode> = {
  not_started: <CircleDashed className="size-3" aria-hidden />,
  ready: <CircleDot className="size-3" aria-hidden />,
  in_progress: <CircleDot className="size-3" aria-hidden />,
  waiting: <Hourglass className="size-3" aria-hidden />,
  blocked: <OctagonAlert className="size-3" aria-hidden />,
  in_review: <Eye className="size-3" aria-hidden />,
  completed: <CheckCircle2 className="size-3" aria-hidden />,
  cancelled: <CircleSlash className="size-3" aria-hidden />,
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const meta = TASK_STATUS_META[status];
  return (
    <Badge tone={meta.tone}>
      {taskStatusIcons[status]}
      {meta.label}
    </Badge>
  );
}

export const HEALTH_META: Record<
  ProjectHealth,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  on_track: { label: "On track", tone: "success" },
  at_risk: { label: "At risk", tone: "warning" },
  off_track: { label: "Off track", tone: "danger" },
  paused: { label: "Paused", tone: "neutral" },
  unknown: { label: "No health set", tone: "neutral" },
};

export function HealthBadge({ health }: { health: ProjectHealth }) {
  const meta = HEALTH_META[health];
  return (
    <Badge tone={meta.tone}>
      {health === "at_risk" || health === "off_track" ? (
        <AlertTriangle className="size-3" aria-hidden />
      ) : health === "paused" ? (
        <CirclePause className="size-3" aria-hidden />
      ) : health === "on_track" ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : (
        <CircleDashed className="size-3" aria-hidden />
      )}
      {meta.label}
    </Badge>
  );
}

export const STAGE_LABELS: Record<ProjectStage, string> = {
  proposed: "Proposed",
  approved: "Approved",
  planning: "Planning",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
};

export function StageBadge({ stage }: { stage: ProjectStage }) {
  const tone =
    stage === "active"
      ? "brand"
      : stage === "completed"
        ? "success"
        : stage === "paused" || stage === "cancelled"
          ? "warning"
          : "neutral";
  return <Badge tone={tone}>{STAGE_LABELS[stage]}</Badge>;
}

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; tone: "neutral" | "info" | "warning" | "danger" }
> = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "info" },
  high: { label: "High", tone: "warning" },
  critical: { label: "Critical", tone: "danger" },
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const meta = PRIORITY_META[priority];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
