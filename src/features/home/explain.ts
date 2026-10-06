import { EXPLANATION_REASONS, type AttentionReason, type AttentionScore } from "./attention";
import type { HomeT } from "./i18n";

/** One reason in words. */
export function reasonText(reason: AttentionReason, t: HomeT): string {
  switch (reason.rule) {
    case "overdue":
      return reason.days === 1 ? t("attention.overdueOne") : t("attention.overdueMany", { days: reason.days });
    case "due_today":
      return t("attention.dueToday");
    case "due_soon":
      return reason.days === 1 ? t("attention.dueTomorrow") : t("attention.dueIn", { days: reason.days });
    case "project_overdue":
      return t("attention.projectOverdue", { project: reason.project });
    case "project_deadline":
      if (reason.days === 0) return t("attention.projectToday", { project: reason.project });
      if (reason.days === 1) return t("attention.projectTomorrow", { project: reason.project });
      return t("attention.projectIn", { project: reason.project, days: reason.days });
    case "blocks":
      return reason.count === 1 ? t("attention.blocksOne") : t("attention.blocksMany", { count: reason.count });
    case "my_tasks_in_project":
      return reason.count === 1 ? t("attention.myTasksOne") : t("attention.myTasksMany", { count: reason.count });
    case "project_priority":
      return t(`attention.projectPriority.${reason.priority}`);
    case "task_priority":
      return t(`attention.taskPriority.${reason.priority}`);
    case "mentions":
      return reason.count === 1 ? t("attention.mentionsOne") : t("attention.mentionsMany", { count: reason.count });
    case "role":
      return t(`attention.role.${reason.role}`);
    case "recent_changes":
      return reason.count === 1 ? t("attention.changedOne") : t("attention.changedMany", { count: reason.count });
  }
}

/**
 * The plain-language explanation: the strongest reasons, joined.
 * "Website launch in 3 days; 2 of your tasks block it".
 */
export function explainAttention(attention: AttentionScore, t: HomeT, limit = EXPLANATION_REASONS): string {
  return attention.reasons
    .slice(0, limit)
    .map((reason) => reasonText(reason, t))
    .join(t("attention.separator"));
}
