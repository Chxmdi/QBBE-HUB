/** English text for approvals on any object (Workspace OS V2-7). */
export const objectApprovalsEn = {
  title: "Approval",
  heading: "Approval for {title}",
  backToRecord: "Back to the record",
  kind: {
    task: "Task",
    project: "Project",
    meeting: "Meeting",
    decision: "Decision",
  },
  none: "No approval has been requested for this record.",
  history: "Approvals",
  status: {
    pending: "Waiting for approval",
    approved: "Approved",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
  },
  currentStep: "Now with: {label}",
  requestedBy: "Requested by {name} on {date}",
  decidedOn: "Decided on {date}",
  openItem: "Open in Approvals",
  request: {
    heading: "Request approval",
    hint: "The request follows your organization's approval rules, including delegation, and appears in the approvers' inbox.",
    titleLabel: "What needs approving (optional)",
    titleHint: "Leave empty to use the record's name.",
    noteLabel: "Note for the approver (optional)",
    submit: "Request approval",
    sent: "Approval requested.",
    error: "The approval could not be requested. You need to be staff and able to change this record, and it must not already be waiting.",
    waiting: "This record is already waiting for approval.",
  },
  errors: {
    notFound: "That record is not available.",
    invalidInput: "Check the form and try again.",
  },
};
