/** Spaces (M10a): English. */
export const spacesEn = {
  metaTitle: "Spaces",
  title: "Spaces",
  description:
    "Every piece of work lives in a space. The Workspace is shared with staff, each program is a space, and your private space is yours alone.",
  sections: {
    workspace: "Workspace",
    private: "Your private space",
    programs: "Programs",
    custom: "Other spaces",
  },
  kinds: {
    workspace: "Workspace",
    program: "Program",
    private: "Private",
    custom: "Space",
  },
  archived: "Archived",
  youCan: "You can:",
  nothingYet: "No access yet",
  emptyPrograms: "No program spaces you can see.",
  emptyCustom: "No other spaces yet.",
  capabilities: {
    view: "view",
    comment: "comment",
    edit_content: "edit content",
    edit_structure: "edit structure",
    manage: "manage",
    run_workflow: "run workflows",
    share: "share",
  },
  create: {
    heading: "Create a space",
    help: "Only administrators create spaces. Name it in both languages.",
    nameEn: "Name in English",
    nameFr: "Name in French",
    descriptionLabel: "Description (optional)",
    submit: "Create space",
    submitting: "Creating…",
    created: "Space created.",
  },
  errors: {
    invalid: "Enter a name in both languages (up to 120 characters).",
    forbidden: "Only an administrator with two-step sign-in can create a space.",
    failed: "The space could not be created. Try again.",
  },
} as const;
