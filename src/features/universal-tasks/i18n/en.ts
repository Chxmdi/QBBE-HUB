/** Universal tasks: English source catalogue (M7). */
export const universalTasksEn = {
  source: {
    label: "Source",
    from: "From {kind}",
    fromNamed: "From {kind}: {title}",
    unavailable: "From a {kind} you can't open",
    kind: {
      manual: "task form",
      meeting: "meeting",
      document: "document",
      comment: "comment",
      project: "project template",
      message: "message",
      workflow: "workflow",
      contact: "contact follow-up",
      template: "record template",
      recurrence: "recurring task",
      capture: "capture inbox",
      command: "command palette",
    },
  },
  errors: {
    invalid: "Check the task details and try again.",
    sourceNotFound: "The item this task comes from is not available to you.",
    saveFailed: "Could not create the task.",
  },
} as const;

export type UniversalTasksMessages = typeof universalTasksEn;
